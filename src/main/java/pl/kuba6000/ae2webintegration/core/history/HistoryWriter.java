package pl.kuba6000.ae2webintegration.core.history;

import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * The one thread that writes to the history database. Callers only ever enqueue; this thread batches what
 * has queued up into one transaction, coalescing repeated writes to the same bucket on the way. While the
 * database is unreachable it keeps the batch and retries with backoff, and the queue drops its oldest
 * entries once full - the server thread is never made to wait for the database.
 */
final class HistoryWriter implements Runnable {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    static final int QUEUE_CAPACITY = 250_000;
    private static final int MAX_BATCH = 50_000;
    private static final long MAX_BACKOFF_MILLIS = TimeUnit.MINUTES.toMillis(1);
    private static final long COMPRESS_AFTER_MILLIS = TimeUnit.DAYS.toMillis(1);
    static final int SCHEMA_VERSION = 1;

    // --- Queued operations ---

    abstract static class Op {
    }

    /** A gauge value or counter delta, depending on the table's kind. */
    static final class SampleOp extends Op {

        final SeriesKey series;
        final long tsMillis;
        final long value;

        SampleOp(SeriesKey series, long tsMillis, long value) {
            this.series = series;
            this.tsMillis = tsMillis;
            this.value = value;
        }
    }

    static final class CoverageOp extends Op {

        final HistoryTable table;
        final String scope;
        final long fromMillis;
        final long toMillis;

        CoverageOp(HistoryTable table, String scope, long fromMillis, long toMillis) {
            this.table = table;
            this.scope = scope;
            this.fromMillis = fromMillis;
            this.toMillis = toMillis;
        }
    }

    /** Deletes every series of {@code scope} in {@code table} whose key is not in {@code keep}. */
    static final class RetainOp extends Op {

        final HistoryTable table;
        final String scope;
        final String[] keep;

        RetainOp(HistoryTable table, String scope, String[] keep) {
            this.table = table;
            this.scope = scope;
            this.keep = keep;
        }
    }

    static final class PruneOp extends Op {

        final HistoryTable table;
        final long beforeMillis;

        PruneOp(HistoryTable table, long beforeMillis) {
            this.table = table;
            this.beforeMillis = beforeMillis;
        }
    }

    static final class MetaOp extends Op {

        final String name;
        final String value;

        MetaOp(String name, String value) {
            this.name = name;
            this.value = value;
        }
    }

    interface SqlTask {

        void run(Connection connection, HistoryWriter writer) throws SQLException;
    }

    /** Runs in its own transaction; {@code afterCommit} runs only once that transaction committed. */
    static final class TaskOp extends Op {

        final String label;
        final SqlTask task;
        final Runnable afterCommit;

        TaskOp(String label, SqlTask task, Runnable afterCommit) {
            this.label = label;
            this.task = task;
            this.afterCommit = afterCommit;
        }
    }

    static final class FlushOp extends Op {

        final CountDownLatch done = new CountDownLatch(1);
    }

    static final class SeriesKey {

        final HistoryTable table;
        final String scope;
        final String key;

        SeriesKey(HistoryTable table, String scope, String key) {
            this.table = table;
            this.scope = scope;
            this.key = key;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof SeriesKey)) {
                return false;
            }
            SeriesKey other = (SeriesKey) o;
            return table == other.table && scope.equals(other.scope) && key.equals(other.key);
        }

        @Override
        public int hashCode() {
            return Objects.hash(table, scope, key);
        }
    }

    // --- State ---

    private final HistoryDb db;
    private final LinkedBlockingDeque<Op> queue = new LinkedBlockingDeque<>(QUEUE_CAPACITY);
    private final ConcurrentHashMap<SeriesKey, Integer> seriesIds = new ConcurrentHashMap<>();
    private volatile boolean timescale;
    private volatile boolean stopping;
    private Thread thread;
    private Connection connection;
    private long droppedSinceLastLog;
    private long nextDropLogMillis;

    HistoryWriter(HistoryDb db) {
        this.db = db;
    }

    synchronized void start() {
        if (thread != null) {
            return;
        }
        thread = new Thread(this, "ae2webintegration-history-writer");
        thread.setDaemon(true);
        thread.start();
    }

    /** Stops after the queue drained or {@code timeoutMillis} passed, whichever comes first. */
    void stop(long timeoutMillis) {
        flush(timeoutMillis);
        stopping = true;
        Thread current = thread;
        if (current != null) {
            current.interrupt();
            try {
                current.join(TimeUnit.SECONDS.toMillis(2));
            } catch (InterruptedException e) {
                Thread.currentThread()
                    .interrupt();
            }
        }
    }

    boolean isTimescale() {
        return timescale;
    }

    void enqueue(Op op) {
        while (!queue.offerLast(op)) {
            if (queue.pollFirst() != null) {
                onDropped();
            }
        }
    }

    private synchronized void onDropped() {
        droppedSinceLastLog++;
        // A dropped change would make the next unchanged sample look already written - start over.
        db.forgetWrittenValues();
        long now = System.currentTimeMillis();
        if (now >= nextDropLogMillis) {
            LOG.warn(
                "History database queue is full ({} entries), dropped {} oldest entries so far",
                QUEUE_CAPACITY,
                droppedSinceLastLog);
            nextDropLogMillis = now + TimeUnit.MINUTES.toMillis(1);
        }
    }

    /** Blocks until everything enqueued before this call is committed, or the timeout passed. */
    boolean flush(long timeoutMillis) {
        FlushOp op = new FlushOp();
        enqueue(op);
        try {
            return op.done.await(timeoutMillis, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread()
                .interrupt();
            return false;
        }
    }

    // --- Writer thread ---

    @Override
    public void run() {
        List<Op> batch = new ArrayList<>();
        long backoffMillis = 1000L;
        long nextUnreachableLogMillis = 0L;
        while (!stopping) {
            if (batch.isEmpty()) {
                Op first;
                try {
                    first = queue.pollFirst(1, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    continue;
                }
                if (first == null) {
                    continue;
                }
                batch.add(first);
                queue.drainTo(batch, MAX_BATCH - 1);
            }
            try {
                process(batch);
                batch.clear();
                backoffMillis = 1000L;
            } catch (SQLException | RuntimeException e) {
                boolean reachable = isConnectionUsable();
                closeConnection();
                if (reachable) {
                    // The database answered and refused: retrying the same batch would fail the same way.
                    LOG.error("History database rejected a batch of " + batch.size() + " writes, dropping it", e);
                    releaseFlushes(batch);
                    batch.clear();
                    continue;
                }
                long now = System.currentTimeMillis();
                if (now >= nextUnreachableLogMillis) {
                    LOG.warn(
                        "History database unreachable ({}), keeping {} writes and retrying",
                        e.getMessage(),
                        batch.size() + queue.size());
                    nextUnreachableLogMillis = now + TimeUnit.MINUTES.toMillis(5);
                }
                try {
                    Thread.sleep(backoffMillis);
                } catch (InterruptedException ignored) {
                    // stop() interrupts; the loop condition handles it.
                }
                backoffMillis = Math.min(MAX_BACKOFF_MILLIS, backoffMillis * 2);
            }
        }
        closeConnection();
    }

    private static void releaseFlushes(List<Op> ops) {
        for (Op op : ops) {
            if (op instanceof FlushOp) {
                ((FlushOp) op).done.countDown();
            }
        }
    }

    /**
     * Writes the batch in order. Committed prefixes are removed from {@code batch} as they commit, so a
     * retry after a lost connection never repeats a counter delta that already landed.
     */
    private void process(List<Op> batch) throws SQLException {
        Connection c = connection();
        c.setAutoCommit(false);
        Pending pending = new Pending();
        List<FlushOp> flushes = new ArrayList<>();
        int index = 0;
        while (index < batch.size()) {
            Op op = batch.get(index);
            if (op instanceof SampleOp) {
                pending.add((SampleOp) op);
            } else if (op instanceof CoverageOp) {
                pending.add((CoverageOp) op);
            } else if (op instanceof MetaOp) {
                pending.meta.put(((MetaOp) op).name, ((MetaOp) op).value);
            } else if (op instanceof RetainOp) {
                pending.write(c, this);
                retain(c, (RetainOp) op);
            } else if (op instanceof PruneOp) {
                pending.write(c, this);
                prune(c, (PruneOp) op);
            } else if (op instanceof FlushOp) {
                flushes.add((FlushOp) op);
            } else if (op instanceof TaskOp) {
                pending.write(c, this);
                c.commit();
                for (FlushOp flush : flushes) {
                    flush.done.countDown();
                }
                flushes.clear();
                batch.subList(0, index)
                    .clear();
                index = 0;
                runTask(c, (TaskOp) op);
                batch.remove(0);
                continue;
            }
            index++;
        }
        pending.write(c, this);
        c.commit();
        for (FlushOp flush : flushes) {
            flush.done.countDown();
        }
    }

    private void runTask(Connection c, TaskOp op) throws SQLException {
        try {
            op.task.run(c, this);
            c.commit();
        } catch (SQLException | RuntimeException e) {
            try {
                c.rollback();
            } catch (SQLException ignored) {}
            // Series rows the task created were rolled back with it; re-resolve instead of trusting the cache.
            seriesIds.clear();
            if (!isConnectionUsable()) {
                throw e;
            }
            LOG.error("History database task '" + op.label + "' failed", e);
            return;
        }
        if (op.afterCommit != null) {
            try {
                op.afterCommit.run();
            } catch (RuntimeException e) {
                LOG.error("History database task '" + op.label + "' committed, but its follow-up failed", e);
            }
        }
    }

    /** Writes a list of operations inside the caller's transaction - used by import tasks. */
    void writeAll(Connection c, List<? extends Op> ops) throws SQLException {
        Pending pending = new Pending();
        for (Op op : ops) {
            if (op instanceof SampleOp) {
                pending.add((SampleOp) op);
            } else if (op instanceof CoverageOp) {
                pending.add((CoverageOp) op);
            } else if (op instanceof MetaOp) {
                pending.meta.put(((MetaOp) op).name, ((MetaOp) op).value);
            } else {
                throw new IllegalArgumentException("Unsupported import operation " + op.getClass());
            }
        }
        pending.write(c, this);
    }

    /** Coalesced writes waiting for the next statement batch. */
    private static final class Pending {

        final Map<HistoryTable, LinkedHashMap<SampleKey, Long>> samples = new LinkedHashMap<>();
        final LinkedHashMap<CoverageKey, long[]> coverage = new LinkedHashMap<>();
        final LinkedHashMap<String, String> meta = new LinkedHashMap<>();

        void add(SampleOp op) {
            LinkedHashMap<SampleKey, Long> table = samples.computeIfAbsent(op.series.table, k -> new LinkedHashMap<>());
            SampleKey key = new SampleKey(op.series, op.tsMillis);
            if (op.series.table.kind == HistoryTable.Kind.COUNTER) {
                table.merge(key, op.value, HistoryWriter::saturatedAdd);
            } else {
                table.put(key, op.value);
            }
        }

        void add(CoverageOp op) {
            long[] range = coverage.get(new CoverageKey(op.table, op.scope, op.fromMillis));
            if (range == null) {
                coverage.put(new CoverageKey(op.table, op.scope, op.fromMillis), new long[] { op.toMillis });
            } else {
                range[0] = Math.max(range[0], op.toMillis);
            }
        }

        void write(Connection c, HistoryWriter writer) throws SQLException {
            for (Map.Entry<HistoryTable, LinkedHashMap<SampleKey, Long>> entry : samples.entrySet()) {
                writer.writeSamples(c, entry.getKey(), entry.getValue());
            }
            samples.clear();
            if (!coverage.isEmpty()) {
                try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO ae2wi_coverage AS c (tbl, scope, from_ts, to_ts) VALUES (?, ?, ?, ?)"
                        + " ON CONFLICT (tbl, scope, from_ts) DO UPDATE SET to_ts = GREATEST(c.to_ts, EXCLUDED.to_ts)")) {
                    for (Map.Entry<CoverageKey, long[]> entry : coverage.entrySet()) {
                        ps.setString(1, entry.getKey().table.id);
                        ps.setString(2, entry.getKey().scope);
                        ps.setTimestamp(3, HistoryDb.timestamp(entry.getKey().fromMillis), HistoryDb.utc());
                        ps.setTimestamp(4, HistoryDb.timestamp(entry.getValue()[0]), HistoryDb.utc());
                        ps.addBatch();
                    }
                    ps.executeBatch();
                }
                coverage.clear();
            }
            if (!meta.isEmpty()) {
                try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO ae2wi_meta (name, value) VALUES (?, ?)"
                        + " ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value")) {
                    for (Map.Entry<String, String> entry : meta.entrySet()) {
                        ps.setString(1, entry.getKey());
                        ps.setString(2, entry.getValue());
                        ps.addBatch();
                    }
                    ps.executeBatch();
                }
                meta.clear();
            }
        }
    }

    private static final class SampleKey {

        final SeriesKey series;
        final long tsMillis;

        SampleKey(SeriesKey series, long tsMillis) {
            this.series = series;
            this.tsMillis = tsMillis;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof SampleKey && ((SampleKey) o).tsMillis == tsMillis
                && ((SampleKey) o).series.equals(series);
        }

        @Override
        public int hashCode() {
            return series.hashCode() * 31 + Long.hashCode(tsMillis);
        }
    }

    private static final class CoverageKey {

        final HistoryTable table;
        final String scope;
        final long fromMillis;

        CoverageKey(HistoryTable table, String scope, long fromMillis) {
            this.table = table;
            this.scope = scope;
            this.fromMillis = fromMillis;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof CoverageKey)) {
                return false;
            }
            CoverageKey other = (CoverageKey) o;
            return table == other.table && fromMillis == other.fromMillis && scope.equals(other.scope);
        }

        @Override
        public int hashCode() {
            return Objects.hash(table, scope, fromMillis);
        }
    }

    private void writeSamples(Connection c, HistoryTable table, LinkedHashMap<SampleKey, Long> samples)
        throws SQLException {
        List<SeriesKey> series = new ArrayList<>();
        for (SampleKey key : samples.keySet()) {
            series.add(key.series);
        }
        resolveSeriesIds(c, series);
        String update = table.kind == HistoryTable.Kind.COUNTER
            ? "LEAST(t.value::numeric + EXCLUDED.value, 9223372036854775807)::bigint"
            : "EXCLUDED.value";
        try (PreparedStatement ps = c.prepareStatement(
            "INSERT INTO " + table.sqlName()
                + " AS t (series_id, ts, value) VALUES (?, ?, ?) ON CONFLICT (series_id, ts) DO UPDATE SET value = "
                + update)) {
            for (Map.Entry<SampleKey, Long> entry : samples.entrySet()) {
                ps.setInt(1, seriesIds.get(entry.getKey().series));
                ps.setTimestamp(2, HistoryDb.timestamp(entry.getKey().tsMillis), HistoryDb.utc());
                ps.setLong(3, entry.getValue());
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }

    private void resolveSeriesIds(Connection c, List<SeriesKey> needed) throws SQLException {
        Map<String, List<SeriesKey>> missingByScope = new LinkedHashMap<>();
        for (SeriesKey key : needed) {
            if (!seriesIds.containsKey(key)) {
                missingByScope.computeIfAbsent(key.table.id + '\u0000' + key.scope, k -> new ArrayList<>())
                    .add(key);
            }
        }
        if (missingByScope.isEmpty()) {
            return;
        }
        try (PreparedStatement ps = c.prepareStatement(
            "INSERT INTO ae2wi_series (tbl, scope, key) VALUES (?, ?, ?) ON CONFLICT (tbl, scope, key) DO NOTHING")) {
            for (List<SeriesKey> keys : missingByScope.values()) {
                for (SeriesKey key : keys) {
                    ps.setString(1, key.table.id);
                    ps.setString(2, key.scope);
                    ps.setString(3, key.key);
                    ps.addBatch();
                }
            }
            ps.executeBatch();
        }
        Map<String, HistoryTable> tables = new HashMap<>();
        for (HistoryTable table : HistoryTable.values()) {
            tables.put(table.id, table);
        }
        try (PreparedStatement ps = c
            .prepareStatement("SELECT id, tbl, scope, key FROM ae2wi_series WHERE tbl = ? AND scope = ?")) {
            for (List<SeriesKey> keys : missingByScope.values()) {
                ps.setString(1, keys.get(0).table.id);
                ps.setString(2, keys.get(0).scope);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        HistoryTable table = tables.get(rs.getString(2));
                        if (table != null) {
                            seriesIds.put(new SeriesKey(table, rs.getString(3), rs.getString(4)), rs.getInt(1));
                        }
                    }
                }
            }
        }
    }

    private void retain(Connection c, RetainOp op) throws SQLException {
        Array keep = c.createArrayOf("text", op.keep);
        try (PreparedStatement samples = c.prepareStatement(
            "DELETE FROM " + op.table.sqlName()
                + " WHERE series_id IN (SELECT id FROM ae2wi_series WHERE tbl = ? AND scope = ? AND NOT (key = ANY(?)))");
            PreparedStatement series = c
                .prepareStatement("DELETE FROM ae2wi_series WHERE tbl = ? AND scope = ? AND NOT (key = ANY(?))")) {
            for (PreparedStatement ps : new PreparedStatement[] { samples, series }) {
                ps.setString(1, op.table.id);
                ps.setString(2, op.scope);
                ps.setArray(3, keep);
                ps.executeUpdate();
            }
        }
        Set<String> kept = new HashSet<>(Arrays.asList(op.keep));
        seriesIds.keySet()
            .removeIf(k -> k.table == op.table && k.scope.equals(op.scope) && !kept.contains(k.key));
    }

    private void prune(Connection c, PruneOp op) throws SQLException {
        if (timescale) {
            // Drops whole chunks only, so up to one chunk interval of older data can outlive the cutoff.
            try (PreparedStatement ps = c
                .prepareStatement("SELECT drop_chunks('" + op.table.sqlName() + "', older_than => ?::timestamptz)")) {
                ps.setTimestamp(1, HistoryDb.timestamp(op.beforeMillis), HistoryDb.utc());
                ps.executeQuery()
                    .close();
            }
        } else {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM " + op.table.sqlName() + " WHERE ts < ?")) {
                ps.setTimestamp(1, HistoryDb.timestamp(op.beforeMillis), HistoryDb.utc());
                ps.executeUpdate();
            }
        }
        try (PreparedStatement ps = c.prepareStatement("DELETE FROM ae2wi_coverage WHERE tbl = ? AND to_ts < ?")) {
            ps.setString(1, op.table.id);
            ps.setTimestamp(2, HistoryDb.timestamp(op.beforeMillis), HistoryDb.utc());
            ps.executeUpdate();
        }
    }

    // --- Connection and schema ---

    private Connection connection() throws SQLException {
        if (connection == null) {
            Connection c = db.connect();
            try {
                ensureSchema(c);
            } catch (SQLException | RuntimeException e) {
                try {
                    c.close();
                } catch (SQLException ignored) {}
                throw e;
            }
            connection = c;
        }
        return connection;
    }

    private boolean isConnectionUsable() {
        try {
            return connection != null && connection.isValid(5);
        } catch (SQLException e) {
            return false;
        }
    }

    private void closeConnection() {
        if (connection != null) {
            try {
                connection.close();
            } catch (SQLException ignored) {}
            connection = null;
        }
    }

    private void ensureSchema(Connection c) throws SQLException {
        c.setAutoCommit(true);
        try (Statement st = c.createStatement()) {
            st.execute("CREATE TABLE IF NOT EXISTS ae2wi_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
            st.execute(
                "CREATE TABLE IF NOT EXISTS ae2wi_series (id SERIAL PRIMARY KEY, tbl TEXT NOT NULL,"
                    + " scope TEXT NOT NULL, key TEXT NOT NULL, UNIQUE (tbl, scope, key))");
            st.execute(
                "CREATE TABLE IF NOT EXISTS ae2wi_coverage (tbl TEXT NOT NULL, scope TEXT NOT NULL,"
                    + " from_ts TIMESTAMPTZ NOT NULL, to_ts TIMESTAMPTZ NOT NULL, PRIMARY KEY (tbl, scope, from_ts))");
            for (HistoryTable table : HistoryTable.values()) {
                st.execute(
                    "CREATE TABLE IF NOT EXISTS " + table.sqlName()
                        + " (series_id INT NOT NULL, ts TIMESTAMPTZ NOT NULL, value BIGINT NOT NULL,"
                        + " PRIMARY KEY (series_id, ts))");
            }
            st.execute(
                "INSERT INTO ae2wi_meta (name, value) VALUES ('schema_version', '" + SCHEMA_VERSION
                    + "') ON CONFLICT (name) DO NOTHING");
            try (ResultSet rs = st.executeQuery("SELECT value FROM ae2wi_meta WHERE name = 'schema_version'")) {
                if (rs.next() && Integer.parseInt(rs.getString(1)) > SCHEMA_VERSION) {
                    LOG.warn(
                        "History database schema version {} is newer than this mod's ({}); writing anyway",
                        rs.getString(1),
                        SCHEMA_VERSION);
                }
            }
            boolean hasTimescale;
            try (ResultSet rs = st.executeQuery("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")) {
                hasTimescale = rs.next();
            }
            if (hasTimescale) {
                for (HistoryTable table : HistoryTable.values()) {
                    setUpHypertable(c, table);
                }
            }
            timescale = hasTimescale;
        }
        seriesIds.clear();
        try (Statement st = c.createStatement();
            ResultSet rs = st.executeQuery("SELECT id, tbl, scope, key FROM ae2wi_series")) {
            Map<String, HistoryTable> tables = new HashMap<>();
            for (HistoryTable table : HistoryTable.values()) {
                tables.put(table.id, table);
            }
            while (rs.next()) {
                HistoryTable table = tables.get(rs.getString(2));
                if (table != null) {
                    seriesIds.put(new SeriesKey(table, rs.getString(3), rs.getString(4)), rs.getInt(1));
                }
            }
        }
        LOG.info("History database connected{}", timescale ? " (TimescaleDB)" : "");
    }

    private static void setUpHypertable(Connection c, HistoryTable table) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
            "SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_schema = current_schema()"
                + " AND hypertable_name = ?")) {
            ps.setString(1, table.sqlName());
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return;
                }
            }
        }
        try (Statement st = c.createStatement()) {
            st.executeQuery(
                "SELECT create_hypertable('" + table.sqlName()
                    + "', 'ts', chunk_time_interval => INTERVAL '"
                    + table.chunkMillis
                    + " milliseconds', migrate_data => TRUE)")
                .close();
        }
        try (Statement st = c.createStatement()) {
            st.execute(
                "ALTER TABLE " + table.sqlName()
                    + " SET (timescaledb.compress, timescaledb.compress_segmentby = 'series_id',"
                    + " timescaledb.compress_orderby = 'ts')");
            st.executeQuery(
                "SELECT add_compression_policy('" + table.sqlName()
                    + "', INTERVAL '"
                    + COMPRESS_AFTER_MILLIS
                    + " milliseconds', if_not_exists => TRUE)")
                .close();
        } catch (SQLException e) {
            // The Apache-2 licensed TimescaleDB build has no compression; chunked tables still help.
            LOG.warn("TimescaleDB compression unavailable for {}: {}", table.sqlName(), e.getMessage());
        }
    }

    static long saturatedAdd(long a, long b) {
        long result = a + b;
        if (((a ^ result) & (b ^ result)) < 0) {
            return a < 0 ? Long.MIN_VALUE : Long.MAX_VALUE;
        }
        return result;
    }
}
