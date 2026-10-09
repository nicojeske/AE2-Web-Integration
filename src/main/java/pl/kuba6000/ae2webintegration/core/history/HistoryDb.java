package pl.kuba6000.ae2webintegration.core.history;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryWriter.SeriesKey;

/**
 * History storage in PostgreSQL (TimescaleDB when the extension is installed). Item statistics and GregTech
 * power/production history exist only while {@code history.jdbc_url} is configured.
 * <p>
 * Writes ({@link #putGauge}, {@link #addCounter}, {@link #markSampled}, ...) come from the server thread and
 * only enqueue for {@link HistoryWriter}. Reads run on the calling HTTP worker over a separate connection,
 * answer within the query timeout, and degrade to "no data" rather than failing a request when the database
 * is unreachable. Writes become visible to reads once the writer committed them, normally within a second.
 */
public final class HistoryDb {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    public static final long NO_SAMPLE = -1L;

    private static final long PRUNE_INTERVAL_MILLIS = TimeUnit.MINUTES.toMillis(10);
    private static final int READ_TIMEOUT_SECONDS = 10;

    private static volatile HistoryDb active;

    private final String url;
    private final String user;
    private final String password;
    final HistoryWriter writer;

    private final Object readLock = new Object();
    private Connection readConnection;
    private long nextReadErrorLogMillis;

    /** Last value and timestamp written per change-only series. Server thread only, cleared on drops. */
    private final ConcurrentHashMap<SeriesKey, long[]> written = new ConcurrentHashMap<>();
    /** Last name written per series. Server thread only. */
    private final ConcurrentHashMap<SeriesKey, String> writtenNames = new ConcurrentHashMap<>();
    /** Open coverage interval per (table, scope): {fromMillis, toMillis}. */
    private final ConcurrentHashMap<String, long[]> coverage = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<HistoryTable, Long> nextPruneMillis = new ConcurrentHashMap<>();
    /** Server thread only. */
    private long nextCraftJobPruneMillis;

    private HistoryDb(String url, String user, String password) {
        this.url = url;
        this.user = user;
        this.password = password;
        this.writer = new HistoryWriter(this);
    }

    // --- Lifecycle ---

    /** The running database backend, or {@code null} when none is configured - then there is no history. */
    public static HistoryDb get() {
        return active;
    }

    /** Starts the backend if {@code history.jdbc_url} is set. Never blocks on the database itself. */
    public static synchronized void start() {
        String configuredUrl = Config.historyJdbcUrl();
        if (configuredUrl.isEmpty()) {
            return;
        }
        HistoryDb current = active;
        if (current != null) {
            if (current.url.equals(configuredUrl)) {
                return;
            }
            stop();
        }
        start(configuredUrl, Config.historyDbUser(), Config.historyDbPassword());
    }

    static synchronized HistoryDb start(String url, String user, String password) {
        if (!url.startsWith("jdbc:postgresql:")) {
            LOG.error("history.jdbc_url must be a jdbc:postgresql:// URL, history is disabled");
            return null;
        }
        HistoryDb db = new HistoryDb(url, user, password);
        db.writer.start();
        active = db;
        LOG.info("Statistics and GregTech history are stored in the history database");
        return db;
    }

    /** Commits what is queued (bounded by a timeout) and disconnects. */
    public static synchronized void stop() {
        HistoryDb current = active;
        if (current == null) {
            return;
        }
        active = null;
        current.writer.stop(TimeUnit.SECONDS.toMillis(10));
        synchronized (current.readLock) {
            current.closeReadConnection();
        }
    }

    /** Waits until everything queued so far is committed; {@code false} on timeout. */
    public boolean flush(long timeoutMillis) {
        return writer.flush(timeoutMillis);
    }

    /**
     * Loads pgjdbc only once a database is actually configured, so a build that does not bundle the driver
     * still starts fine, just without history.
     */
    private static final class DriverHolder {

        static final Driver DRIVER = new org.postgresql.Driver();
    }

    Connection connect() throws SQLException {
        Properties props = new Properties();
        if (!user.isEmpty()) {
            props.setProperty("user", user);
        }
        if (!password.isEmpty()) {
            props.setProperty("password", password);
        }
        props.setProperty("ApplicationName", "ae2webintegration");
        props.setProperty("connectTimeout", "10");
        props.setProperty("socketTimeout", "120");
        props.setProperty("tcpKeepAlive", "true");
        // Instantiated directly rather than through DriverManager, so a relocated (shaded) driver still works.
        Connection connection = DriverHolder.DRIVER.connect(url, props);
        if (connection == null) {
            throw new SQLException("Not a PostgreSQL JDBC URL");
        }
        return connection;
    }

    // --- Writing (server thread) ---

    /**
     * Records a gauge value for the bucket starting at {@code bucketStartMillis}, replacing an earlier value
     * in the same bucket. In a {@link HistoryTable.Kind#CHANGE_GAUGE} table an unchanged value is skipped.
     */
    public void putGauge(HistoryTable table, String scope, String key, long bucketStartMillis, long value) {
        SeriesKey series = new SeriesKey(table, scope, key);
        if (table.kind == HistoryTable.Kind.CHANGE_GAUGE) {
            long[] last = written.get(series);
            if (last != null && last[0] == value
                && bucketStartMillis >= last[1]
                && bucketStartMillis - last[1] < table.anchorMillis) {
                return;
            }
            if (last == null || bucketStartMillis >= last[1]) {
                written.put(series, new long[] { value, bucketStartMillis });
            }
        }
        writer.enqueue(new HistoryWriter.SampleOp(series, bucketStartMillis, value));
    }

    /** Adds {@code delta} to a counter bucket. */
    public void addCounter(HistoryTable table, String scope, String key, long bucketStartMillis, long delta) {
        writer.enqueue(new HistoryWriter.SampleOp(new SeriesKey(table, scope, key), bucketStartMillis, delta));
    }

    /** Labels a series with a display name; only an actual change is written. */
    public void putName(HistoryTable table, String scope, String key, String name) {
        SeriesKey series = new SeriesKey(table, scope, key);
        if (name.equals(writtenNames.put(series, name))) {
            return;
        }
        writer.enqueue(new HistoryWriter.NameOp(series, name));
    }

    /**
     * Keys of every series of {@code scope} in {@code table}: what the database held when the writer connected
     * plus what was written since. Empty until the database was first reached.
     */
    public Set<String> knownKeys(HistoryTable table, String scope) {
        Set<String> keys = writer.keysOf(table, scope);
        for (SeriesKey series : written.keySet()) {
            if (series.table == table && series.scope.equals(scope)) {
                keys.add(series.key);
            }
        }
        return keys;
    }

    /**
     * Notes that every series of {@code scope} in a change-only table was sampled for the bucket starting at
     * {@code bucketStartMillis}. Consecutive buckets extend one interval; a skipped bucket starts a new one,
     * which is what makes the skipped stretch read back as a gap.
     */
    public void markSampled(HistoryTable table, String scope, long bucketStartMillis, long bucketMillis) {
        String coverageKey = table.id + '\u0000' + scope;
        long[] interval = coverage.get(coverageKey);
        if (interval != null && bucketStartMillis >= interval[0] && bucketStartMillis <= interval[1] + bucketMillis) {
            interval[1] = Math.max(interval[1], bucketStartMillis);
        } else {
            interval = new long[] { bucketStartMillis, bucketStartMillis };
            coverage.put(coverageKey, interval);
        }
        writer.enqueue(new HistoryWriter.CoverageOp(table, scope, interval[0], interval[1]));
    }

    /**
     * Drops data older than {@code beforeMillis}; rate-limited, so it is fine to call on every maintenance
     * pass. Change-only tables keep one extra anchor interval so the oldest kept value still has its row.
     */
    public void prune(HistoryTable table, long beforeMillis, long nowMillis) {
        Long next = nextPruneMillis.get(table);
        if (next != null && nowMillis < next) {
            return;
        }
        nextPruneMillis.put(table, nowMillis + PRUNE_INTERVAL_MILLIS);
        writer.enqueue(new HistoryWriter.PruneOp(table, beforeMillis - table.anchorMillis));
    }

    public void putMeta(String name, String value) {
        writer.enqueue(new HistoryWriter.MetaOp(name, value));
    }

    /**
     * Reads a meta value once the database is reachable and hands it (or {@code null}) to {@code onLoaded} on
     * the writer thread. Queued like a write, so anything enqueued after this call lands after it.
     */
    public void loadMeta(String name, Consumer<String> onLoaded) {
        String[] holder = new String[1];
        writer.enqueue(new HistoryWriter.TaskOp("load " + name, (c, w) -> {
            try (PreparedStatement ps = c.prepareStatement("SELECT value FROM ae2wi_meta WHERE name = ?")) {
                ps.setString(1, name);
                try (ResultSet rs = ps.executeQuery()) {
                    holder[0] = rs.next() ? rs.getString(1) : null;
                }
            }
        }, () -> onLoaded.accept(holder[0])));
    }

    void forgetWrittenValues() {
        written.clear();
        writtenNames.clear();
    }

    // --- Crafting job history ---

    /** A finished crafting job as stored; {@code detail} is the crafting-history detail JSON. */
    public static final class CraftJob {

        public final long id;
        public final String outputItemid;
        public final String outputName;
        public final long quantity;
        public final String outputItemKey;
        public final long started;
        public final long done;
        public final boolean cancelled;
        public final String requestedBy;

        CraftJob(ResultSet rs) throws SQLException {
            id = rs.getLong("id");
            outputItemid = rs.getString("output_itemid");
            outputName = rs.getString("output_name");
            quantity = rs.getLong("quantity");
            outputItemKey = rs.getString("output_item_key");
            started = rs.getTimestamp("started", utc())
                .getTime();
            done = rs.getTimestamp("done", utc())
                .getTime();
            cancelled = rs.getBoolean("cancelled");
            requestedBy = rs.getString("requested_by");
        }
    }

    private static final String CRAFT_JOB_COLUMNS = "id, output_itemid, output_name, quantity, output_item_key, started,"
        + " done, cancelled, requested_by";

    /** Queues a finished job for the writer; it shows up in reads once committed. */
    public void putCraftJob(String gridKey, String outputItemid, String outputName, long quantity, String outputItemKey,
        long started, long done, boolean cancelled, String requestedBy, String detailJson) {
        writer.enqueue(new HistoryWriter.TaskOp("craft job", (c, w) -> {
            try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO ae2wi_craft_job (grid_key, output_itemid, output_name, quantity, output_item_key,"
                    + " started, done, cancelled, requested_by, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)")) {
                ps.setString(1, gridKey);
                ps.setString(2, outputItemid);
                ps.setString(3, outputName);
                ps.setLong(4, quantity);
                ps.setString(5, outputItemKey);
                ps.setTimestamp(6, timestamp(started), utc());
                ps.setTimestamp(7, timestamp(done), utc());
                ps.setBoolean(8, cancelled);
                ps.setString(9, requestedBy);
                ps.setString(10, detailJson);
                ps.executeUpdate();
            }
        }, null));
    }

    /**
     * A grid's finished jobs, newest first: those done before {@code beforeMillis} ({@code Long.MAX_VALUE} for
     * no bound), optionally only those producing {@code itemid}. Empty when the database is unreachable.
     */
    public List<CraftJob> readCraftJobs(String gridKey, String itemid, long beforeMillis, int limit) {
        return read(c -> {
            try (PreparedStatement ps = c.prepareStatement(
                "SELECT " + CRAFT_JOB_COLUMNS
                    + " FROM ae2wi_craft_job WHERE grid_key = ?"
                    + (beforeMillis == Long.MAX_VALUE ? "" : " AND done < ?")
                    + (itemid == null ? "" : " AND output_itemid = ?")
                    + " ORDER BY done DESC LIMIT ?")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                int i = 1;
                ps.setString(i++, gridKey);
                if (beforeMillis != Long.MAX_VALUE) ps.setTimestamp(i++, timestamp(beforeMillis), utc());
                if (itemid != null) ps.setString(i++, itemid);
                ps.setInt(i, limit);
                List<CraftJob> jobs = new ArrayList<>();
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) jobs.add(new CraftJob(rs));
                }
                return jobs;
            }
        }, new ArrayList<>());
    }

    /** One job's detail JSON, or {@code null} when there is no such job on that grid or no database. */
    public String readCraftJobDetail(String gridKey, long id) {
        return read(c -> {
            try (PreparedStatement ps = c
                .prepareStatement("SELECT detail::text FROM ae2wi_craft_job WHERE grid_key = ? AND id = ?")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                ps.setString(1, gridKey);
                ps.setLong(2, id);
                try (ResultSet rs = ps.executeQuery()) {
                    return rs.next() ? rs.getString(1) : null;
                }
            }
        }, null);
    }

    /** Drops jobs finished before {@code beforeMillis}; rate-limited like {@link #prune}. */
    public void pruneCraftJobs(long beforeMillis, long nowMillis) {
        if (nowMillis < nextCraftJobPruneMillis) {
            return;
        }
        nextCraftJobPruneMillis = nowMillis + PRUNE_INTERVAL_MILLIS;
        writer.enqueue(new HistoryWriter.TaskOp("prune craft jobs", (c, w) -> {
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM ae2wi_craft_job WHERE done < ?")) {
                ps.setTimestamp(1, timestamp(beforeMillis), utc());
                ps.executeUpdate();
            }
        }, null));
    }

    // --- Reading (HTTP worker threads) ---

    private interface Query<T> {

        T run(Connection connection) throws SQLException;
    }

    private <T> T read(Query<T> query, T fallback) {
        synchronized (readLock) {
            try {
                if (readConnection == null) {
                    readConnection = connect();
                    readConnection.setReadOnly(true);
                }
                return query.run(readConnection);
            } catch (SQLException e) {
                closeReadConnection();
                long now = System.currentTimeMillis();
                if (now >= nextReadErrorLogMillis) {
                    nextReadErrorLogMillis = now + TimeUnit.MINUTES.toMillis(1);
                    LOG.warn("History database read failed, answering without history: {}", e.getMessage());
                }
                return fallback;
            }
        }
    }

    private void closeReadConnection() {
        if (readConnection != null) {
            try {
                readConnection.close();
            } catch (SQLException ignored) {}
            readConnection = null;
        }
    }

    private static int windowCount(long fromBucket, long toBucket, long step) {
        return (int) ((toBucket - fromBucket) / step + 1);
    }

    private static Integer seriesId(Connection c, HistoryTable table, String scope, String key) throws SQLException {
        try (PreparedStatement ps = c
            .prepareStatement("SELECT id FROM ae2wi_series WHERE tbl = ? AND scope = ? AND key = ?")) {
            ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
            ps.setString(1, table.id);
            ps.setString(2, scope);
            ps.setString(3, key);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : null;
            }
        }
    }

    /** The stored display names of those {@code keys} of {@code scope} in {@code table} that have one. */
    public Map<String, String> readNames(HistoryTable table, String scope, Collection<String> keys) {
        Map<String, String> none = new HashMap<>();
        if (keys.isEmpty()) {
            return none;
        }
        return read(c -> {
            Map<String, String> names = new HashMap<>();
            try (PreparedStatement ps = c.prepareStatement(
                "SELECT key, name FROM ae2wi_series WHERE tbl = ? AND scope = ? AND key = ANY(?) AND name IS NOT NULL")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                ps.setString(1, table.id);
                ps.setString(2, scope);
                ps.setArray(3, c.createArrayOf("text", keys.toArray(new String[0])));
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        names.put(rs.getString(1), rs.getString(2));
                    }
                }
            }
            return names;
        }, none);
    }

    /**
     * Newest value in each window of {@code step} buckets over {@code [fromBucket, toBucket]}, or
     * {@link #NO_SAMPLE} for a window without a sample.
     */
    public long[] readGauge(HistoryTable table, String scope, String key, long fromBucket, long toBucket, long step,
        long bucketMillis) {
        long[] empty = new long[windowCount(fromBucket, toBucket, step)];
        Arrays.fill(empty, NO_SAMPLE);
        return read(c -> {
            long[] points = empty.clone();
            Integer id = seriesId(c, table, scope, key);
            if (id == null) {
                return points;
            }
            long fromMillis = fromBucket * bucketMillis;
            long endMillis = (toBucket + 1) * bucketMillis - 1;
            List<long[]> rows = new ArrayList<>();
            if (table.kind == HistoryTable.Kind.CHANGE_GAUGE) {
                try (PreparedStatement ps = c.prepareStatement(
                    "SELECT ts, value FROM " + table.sqlName()
                        + " WHERE series_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1")) {
                    ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                    ps.setInt(1, id);
                    ps.setTimestamp(2, timestamp(fromMillis), utc());
                    collectRows(ps, rows);
                }
            }
            try (PreparedStatement ps = c.prepareStatement(
                "SELECT ts, value FROM " + table.sqlName()
                    + " WHERE series_id = ? AND ts >= ? AND ts <= ? ORDER BY ts")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                ps.setInt(1, id);
                ps.setTimestamp(2, timestamp(fromMillis), utc());
                ps.setTimestamp(3, timestamp(endMillis), utc());
                collectRows(ps, rows);
            }
            if (table.kind != HistoryTable.Kind.CHANGE_GAUGE) {
                for (long[] row : rows) {
                    long bucket = Math.floorDiv(row[0], bucketMillis);
                    points[(int) ((bucket - fromBucket) / step)] = row[1];
                }
                return points;
            }
            List<long[]> covered = readCoverage(c, table, scope, fromMillis, endMillis, bucketMillis);
            fillCarriedForward(points, rows, covered, fromBucket, toBucket, step, bucketMillis);
            return points;
        }, empty);
    }

    private static void collectRows(PreparedStatement ps, List<long[]> into) throws SQLException {
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                into.add(
                    new long[] { rs.getTimestamp(1, utc())
                        .getTime(), rs.getLong(2) });
            }
        }
    }

    /** Coverage intervals in bucket numbers, {fromBucket, toBucket}. */
    private static List<long[]> readCoverage(Connection c, HistoryTable table, String scope, long fromMillis,
        long endMillis, long bucketMillis) throws SQLException {
        List<long[]> intervals = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(
            "SELECT from_ts, to_ts FROM ae2wi_coverage WHERE tbl = ? AND scope = ? AND to_ts >= ? AND from_ts <= ?")) {
            ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
            ps.setString(1, table.id);
            ps.setString(2, scope);
            ps.setTimestamp(3, timestamp(fromMillis), utc());
            ps.setTimestamp(4, timestamp(endMillis), utc());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    intervals.add(
                        new long[] { Math.floorDiv(
                            rs.getTimestamp(1, utc())
                                .getTime(),
                            bucketMillis),
                            Math.floorDiv(
                                rs.getTimestamp(2, utc())
                                    .getTime(),
                                bucketMillis) });
                }
            }
        }
        return intervals;
    }

    /**
     * For each window: the newest bucket that was sampled at all, and the last change at or before it. A
     * window with no sampled bucket, or before the series' first row, stays {@link #NO_SAMPLE}.
     */
    static void fillCarriedForward(long[] points, List<long[]> rowsAscending, List<long[]> coveredBuckets,
        long fromBucket, long toBucket, long step, long bucketMillis) {
        int rowIndex = 0;
        long current = NO_SAMPLE;
        for (int window = 0; window < points.length; window++) {
            long windowStart = fromBucket + window * step;
            long windowEnd = Math.min(windowStart + step - 1, toBucket);
            long newestCovered = Long.MIN_VALUE;
            for (long[] interval : coveredBuckets) {
                if (interval[0] <= windowEnd && interval[1] >= windowStart) {
                    newestCovered = Math.max(newestCovered, Math.min(interval[1], windowEnd));
                }
            }
            if (newestCovered == Long.MIN_VALUE) {
                continue;
            }
            while (rowIndex < rowsAscending.size()
                && Math.floorDiv(rowsAscending.get(rowIndex)[0], bucketMillis) <= newestCovered) {
                current = rowsAscending.get(rowIndex)[1];
                rowIndex++;
            }
            points[window] = current;
        }
    }

    /** Sum per window over every series of {@code scopes} (and {@code key}, unless {@code null}). */
    public long[] readCounterWindows(HistoryTable table, Collection<String> scopes, String key, long fromBucket,
        long toBucket, long step, long bucketMillis) {
        long[] zeros = new long[windowCount(fromBucket, toBucket, step)];
        if (scopes.isEmpty()) {
            return zeros;
        }
        return read(c -> {
            long[] points = zeros.clone();
            try (PreparedStatement ps = c.prepareStatement(
                "SELECT p.ts, SUM(p.value) FROM " + table.sqlName()
                    + " p JOIN ae2wi_series s ON s.id = p.series_id WHERE s.tbl = ? AND s.scope = ANY(?)"
                    + (key == null ? "" : " AND s.key = ?")
                    + " AND p.ts >= ? AND p.ts <= ? GROUP BY p.ts")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                int i = 1;
                ps.setString(i++, table.id);
                ps.setArray(i++, c.createArrayOf("text", scopes.toArray(new String[0])));
                if (key != null) {
                    ps.setString(i++, key);
                }
                ps.setTimestamp(i++, timestamp(fromBucket * bucketMillis), utc());
                ps.setTimestamp(i, timestamp(toBucket * bucketMillis), utc());
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        long bucket = Math.floorDiv(
                            rs.getTimestamp(1, utc())
                                .getTime(),
                            bucketMillis);
                        int window = (int) ((bucket - fromBucket) / step);
                        points[window] = HistoryWriter.saturatedAdd(points[window], saturate(rs.getBigDecimal(2)));
                    }
                }
            }
            return points;
        }, zeros);
    }

    /** One series' total from {@link #readCounterTotals}. */
    public static final class CounterTotal {

        public final String scope;
        public final String key;
        public final long total;

        CounterTotal(String scope, String key, long total) {
            this.scope = scope;
            this.key = key;
            this.total = total;
        }
    }

    /** Positive totals per series of {@code scopes} over buckets {@code [fromBucket, toBucket]}. */
    public List<CounterTotal> readCounterTotals(HistoryTable table, Collection<String> scopes, long fromBucket,
        long toBucket, long bucketMillis) {
        List<CounterTotal> none = new ArrayList<>();
        if (scopes.isEmpty()) {
            return none;
        }
        return read(c -> {
            List<CounterTotal> totals = new ArrayList<>();
            try (PreparedStatement ps = c.prepareStatement(
                "SELECT s.scope, s.key, SUM(p.value) FROM " + table.sqlName()
                    + " p JOIN ae2wi_series s ON s.id = p.series_id WHERE s.tbl = ? AND s.scope = ANY(?)"
                    + " AND p.ts >= ? AND p.ts <= ? GROUP BY s.scope, s.key HAVING SUM(p.value) > 0")) {
                ps.setQueryTimeout(READ_TIMEOUT_SECONDS);
                ps.setString(1, table.id);
                ps.setArray(2, c.createArrayOf("text", scopes.toArray(new String[0])));
                ps.setTimestamp(3, timestamp(fromBucket * bucketMillis), utc());
                ps.setTimestamp(4, timestamp(toBucket * bucketMillis), utc());
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        totals.add(new CounterTotal(rs.getString(1), rs.getString(2), saturate(rs.getBigDecimal(3))));
                    }
                }
            }
            return totals;
        }, none);
    }

    // --- Helpers ---

    static Timestamp timestamp(long millis) {
        return new Timestamp(millis);
    }

    /** A fresh UTC calendar per use - {@link Calendar} is not thread-safe. */
    static Calendar utc() {
        return Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    }

    private static long saturate(BigDecimal value) {
        if (value == null) {
            return 0L;
        }
        if (value.compareTo(BigDecimal.valueOf(Long.MAX_VALUE)) > 0) {
            return Long.MAX_VALUE;
        }
        if (value.compareTo(BigDecimal.valueOf(Long.MIN_VALUE)) < 0) {
            return Long.MIN_VALUE;
        }
        return value.longValue();
    }
}
