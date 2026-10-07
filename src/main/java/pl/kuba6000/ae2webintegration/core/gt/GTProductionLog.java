package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Predicate;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;
import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

/**
 * What every machine produced, per (machine, item) pair, in hourly and daily buckets; persisted to
 * {@code gtproduction.json}.
 * <p>
 * {@link #record} runs on the server thread for every finished recipe, so it is one or two map updates and
 * nothing else. Bucket edges are whole hours/days: a range starting mid-bucket counts that whole bucket,
 * which is the usual trade-off for bucketed counters and is called out in the response's {@code from}.
 */
public final class GTProductionLog {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    private static final int SCHEMA_VERSION = 1;
    static final long HOUR_MILLIS = TimeUnit.HOURS.toMillis(1);
    static final long DAY_MILLIS = TimeUnit.DAYS.toMillis(1);

    private GTProductionLog() {}

    private static final class PairSeries {

        final BucketSeries hourly;
        final BucketSeries daily;

        PairSeries(BucketSeries hourly, BucketSeries daily) {
            this.hourly = hourly;
            this.daily = daily;
        }
    }

    private static final class MachineProduction {

        volatile String name;
        volatile UUID owner;
        final ConcurrentHashMap<String, PairSeries> stacks = new ConcurrentHashMap<>();
    }

    private static final class StackMeta {

        String name;
        boolean fluid;
    }

    private static final ConcurrentHashMap<String, MachineProduction> machines = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, StackMeta> stackMeta = new ConcurrentHashMap<>();
    private static volatile long trackingSinceMillis;
    private static final AtomicBoolean dirty = new AtomicBoolean(false);
    private static final GTJsonFile<PersistedFile> file = new GTJsonFile<>("gtproduction.json", PersistedFile.class);
    /** Meta row holding machine names/owners and stack names in database mode. */
    private static final String META_NAME = "gtproduction";
    private static volatile boolean metaLoaded;

    // --- Writing (server thread) ---

    public static void record(String machineId, String machineName, UUID owner, String stackId, String stackName,
        long amount, boolean fluid, long nowMillis) {
        if (machineId == null || stackId == null || amount <= 0 || !Config.INSTANCE.gregtech.enabled) {
            return;
        }
        if (trackingSinceMillis == 0L) {
            trackingSinceMillis = nowMillis;
        }
        MachineProduction machine = machines.computeIfAbsent(machineId, k -> new MachineProduction());
        if (machineName != null) {
            machine.name = machineName;
        }
        if (owner != null) {
            machine.owner = owner;
        }
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            db.addCounter(
                HistoryTable.PRODUCTION_HOURLY,
                machineId,
                stackId,
                Math.floorDiv(nowMillis, HOUR_MILLIS) * HOUR_MILLIS,
                amount);
            db.addCounter(
                HistoryTable.PRODUCTION_DAILY,
                machineId,
                stackId,
                Math.floorDiv(nowMillis, DAY_MILLIS) * DAY_MILLIS,
                amount);
        } else {
            PairSeries series = machine.stacks
                .computeIfAbsent(stackId, k -> new PairSeries(new BucketSeries(), new BucketSeries()));
            series.hourly.add(Math.floorDiv(nowMillis, HOUR_MILLIS), amount);
            series.daily.add(Math.floorDiv(nowMillis, DAY_MILLIS), amount);
        }
        StackMeta meta = stackMeta.get(stackId);
        if (meta == null || (stackName != null && !stackName.equals(meta.name))) {
            StackMeta updated = new StackMeta();
            updated.name = stackName != null ? stackName : (meta == null ? stackId : meta.name);
            updated.fluid = fluid;
            stackMeta.put(stackId, updated);
        }
        dirty.set(true);
    }

    static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            // Machine and stack names are kept: they are small, and the database may still hold their rows.
            db.prune(
                HistoryTable.PRODUCTION_HOURLY,
                nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionHourlyRetentionDays),
                nowMillis);
            db.prune(
                HistoryTable.PRODUCTION_DAILY,
                nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionDailyRetentionDays),
                nowMillis);
            return;
        }
        long minHourly = Math.floorDiv(
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionHourlyRetentionDays),
            HOUR_MILLIS);
        long minDaily = Math.floorDiv(
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionDailyRetentionDays),
            DAY_MILLIS);
        for (Map.Entry<String, MachineProduction> machineEntry : machines.entrySet()) {
            MachineProduction machine = machineEntry.getValue();
            for (Map.Entry<String, PairSeries> stackEntry : machine.stacks.entrySet()) {
                PairSeries series = stackEntry.getValue();
                if (series.hourly.prune(minHourly) | series.daily.prune(minDaily)) {
                    dirty.set(true);
                }
                if (series.hourly.isEmpty() && series.daily.isEmpty()) {
                    machine.stacks.remove(stackEntry.getKey(), series);
                }
            }
            if (machine.stacks.isEmpty()) {
                machines.remove(machineEntry.getKey(), machine);
            }
        }
    }

    // --- Reading (HTTP threads) ---

    /** One (machine, stack) total over a range. */
    public static final class Row {

        public final String machineId;
        public final String machineName;
        public final UUID owner;
        public final String stackId;
        public final String stackName;
        public final boolean fluid;
        public final long total;

        Row(String machineId, String machineName, UUID owner, String stackId, String stackName, boolean fluid,
            long total) {
            this.machineId = machineId;
            this.machineName = machineName;
            this.owner = owner;
            this.stackId = stackId;
            this.stackName = stackName;
            this.fluid = fluid;
            this.total = total;
        }
    }

    /** Whether a range starting at {@code fromMillis} can be answered from hourly buckets. */
    static boolean useHourly(long fromMillis, long nowMillis) {
        return fromMillis >= nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionHourlyRetentionDays);
    }

    /**
     * Totals per (machine, stack) with a non-zero amount in {@code [fromMillis, toMillis]}.
     *
     * @param ownerFilter which owners the caller may see; machines without an owner are passed as {@code null}
     * @param machineId   only this machine, or {@code null} for all
     */
    public static List<Row> totals(long fromMillis, long toMillis, long nowMillis, Predicate<UUID> ownerFilter,
        String machineId) {
        boolean hourly = useHourly(fromMillis, nowMillis);
        long bucketMillis = hourly ? HOUR_MILLIS : DAY_MILLIS;
        long fromBucket = Math.floorDiv(fromMillis, bucketMillis);
        long toBucket = Math.floorDiv(toMillis, bucketMillis);
        List<Row> rows = new ArrayList<>();
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            List<HistoryDb.CounterTotal> totals = db.readCounterTotals(
                hourly ? HistoryTable.PRODUCTION_HOURLY : HistoryTable.PRODUCTION_DAILY,
                visibleMachines(ownerFilter, machineId),
                fromBucket,
                toBucket,
                bucketMillis);
            for (HistoryDb.CounterTotal total : totals) {
                MachineProduction machine = machines.get(total.scope);
                StackMeta meta = stackMeta.get(total.key);
                rows.add(
                    new Row(
                        total.scope,
                        machine == null ? null : machine.name,
                        machine == null ? null : machine.owner,
                        total.key,
                        meta == null ? total.key : meta.name,
                        meta != null && meta.fluid,
                        total.total));
            }
            return rows;
        }
        for (Map.Entry<String, MachineProduction> machineEntry : machines.entrySet()) {
            if (machineId != null && !machineId.equals(machineEntry.getKey())) {
                continue;
            }
            MachineProduction machine = machineEntry.getValue();
            if (!ownerFilter.test(machine.owner)) {
                continue;
            }
            for (Map.Entry<String, PairSeries> stackEntry : machine.stacks.entrySet()) {
                PairSeries series = stackEntry.getValue();
                long total = (hourly ? series.hourly : series.daily).sum(fromBucket, toBucket);
                if (total <= 0) {
                    continue;
                }
                StackMeta meta = stackMeta.get(stackEntry.getKey());
                rows.add(
                    new Row(
                        machineEntry.getKey(),
                        machine.name,
                        machine.owner,
                        stackEntry.getKey(),
                        meta == null ? stackEntry.getKey() : meta.name,
                        meta != null && meta.fluid,
                        total));
            }
        }
        return rows;
    }

    /** Wire shape for {@code /api/gt/production/history}. Each point is the amount produced in that window. */
    public static final class Series {

        public String stack;
        public String machine;
        public long from;
        public long to;
        public long stepMillis;
        public String resolution;
        public long[] points;
    }

    /**
     * Amount produced per window, summed over every visible machine (or just {@code machineId}) for one
     * stack (or every stack when {@code stackId} is {@code null}).
     */
    public static Series series(String stackId, String machineId, long fromMillis, long toMillis, long nowMillis,
        int maxPoints, Predicate<UUID> ownerFilter) {
        boolean hourly = useHourly(fromMillis, nowMillis);
        long bucketMillis = hourly ? HOUR_MILLIS : DAY_MILLIS;
        long fromBucket = Math.floorDiv(Math.min(fromMillis, toMillis), bucketMillis);
        long toBucket = Math.max(fromBucket, Math.floorDiv(Math.max(fromMillis, toMillis), bucketMillis));
        long totalBuckets = toBucket - fromBucket + 1;
        int capped = Math.max(1, maxPoints);
        long step = totalBuckets <= capped ? 1 : (totalBuckets + capped - 1) / capped;

        Series series = new Series();
        series.stack = stackId;
        series.machine = machineId;
        series.resolution = hourly ? "hourly" : "daily";
        series.from = fromBucket * bucketMillis;
        series.to = toBucket * bucketMillis;
        series.stepMillis = step * bucketMillis;
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            series.points = db.readCounterWindows(
                hourly ? HistoryTable.PRODUCTION_HOURLY : HistoryTable.PRODUCTION_DAILY,
                visibleMachines(ownerFilter, machineId),
                stackId,
                fromBucket,
                toBucket,
                step,
                bucketMillis);
            return series;
        }

        List<BucketSeries> selected = new ArrayList<>();
        for (Map.Entry<String, MachineProduction> machineEntry : machines.entrySet()) {
            if (machineId != null && !machineId.equals(machineEntry.getKey())) {
                continue;
            }
            MachineProduction machine = machineEntry.getValue();
            if (!ownerFilter.test(machine.owner)) {
                continue;
            }
            for (Map.Entry<String, PairSeries> stackEntry : machine.stacks.entrySet()) {
                if (stackId == null || stackId.equals(stackEntry.getKey())) {
                    selected.add(hourly ? stackEntry.getValue().hourly : stackEntry.getValue().daily);
                }
            }
        }

        List<Long> points = new ArrayList<>();
        for (long windowStart = fromBucket; windowStart <= toBucket; windowStart += step) {
            long windowEnd = Math.min(windowStart + step - 1, toBucket);
            long sum = 0;
            for (BucketSeries bucketSeries : selected) {
                sum = BucketSeries.saturatedAdd(sum, bucketSeries.sum(windowStart, windowEnd));
            }
            points.add(sum);
        }

        series.points = new long[points.size()];
        for (int i = 0; i < series.points.length; i++) {
            series.points[i] = points.get(i);
        }
        return series;
    }

    /** Ids of the known machines {@code ownerFilter} lets through, optionally just {@code machineId}. */
    private static List<String> visibleMachines(Predicate<UUID> ownerFilter, String machineId) {
        List<String> ids = new ArrayList<>();
        for (Map.Entry<String, MachineProduction> entry : machines.entrySet()) {
            if ((machineId == null || machineId.equals(entry.getKey())) && ownerFilter.test(entry.getValue().owner)) {
                ids.add(entry.getKey());
            }
        }
        return ids;
    }

    /** When recording started (first recipe ever recorded), or 0 if nothing has been recorded yet. */
    public static long trackingSinceMillis() {
        return trackingSinceMillis;
    }

    // --- Persistence ---

    private static final class PersistedStack {

        TreeMap<Long, Long> hourly;
        TreeMap<Long, Long> daily;
    }

    private static final class PersistedMachine {

        String name;
        UUID owner;
        Map<String, PersistedStack> stacks = new LinkedHashMap<>();
    }

    private static final class PersistedFile {

        int schemaVersion = SCHEMA_VERSION;
        long trackingSinceMillis;
        Map<String, PersistedMachine> machines = new LinkedHashMap<>();
        Map<String, StackMeta> stacks = new LinkedHashMap<>();
    }

    private static PersistedFile buildSnapshot() {
        PersistedFile snapshot = new PersistedFile();
        snapshot.trackingSinceMillis = trackingSinceMillis;
        for (Map.Entry<String, MachineProduction> machineEntry : machines.entrySet()) {
            MachineProduction machine = machineEntry.getValue();
            PersistedMachine persisted = new PersistedMachine();
            persisted.name = machine.name;
            persisted.owner = machine.owner;
            for (Map.Entry<String, PairSeries> stackEntry : machine.stacks.entrySet()) {
                PersistedStack stack = new PersistedStack();
                stack.hourly = stackEntry.getValue().hourly.snapshot();
                stack.daily = stackEntry.getValue().daily.snapshot();
                persisted.stacks.put(stackEntry.getKey(), stack);
            }
            snapshot.machines.put(machineEntry.getKey(), persisted);
        }
        snapshot.stacks.putAll(stackMeta);
        return snapshot;
    }

    static void loadData() {
        clear();
        PersistedFile loaded = file.load();
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            if (loaded != null) {
                importInto(db, loaded);
            }
            db.loadMeta(META_NAME, GTProductionLog::mergeMeta);
            return;
        }
        if (loaded == null) {
            return;
        }
        trackingSinceMillis = loaded.trackingSinceMillis;
        if (loaded.machines != null) {
            for (Map.Entry<String, PersistedMachine> machineEntry : loaded.machines.entrySet()) {
                PersistedMachine persisted = machineEntry.getValue();
                if (machineEntry.getKey() == null || persisted == null) {
                    continue;
                }
                MachineProduction machine = new MachineProduction();
                machine.name = persisted.name;
                machine.owner = persisted.owner;
                if (persisted.stacks != null) {
                    for (Map.Entry<String, PersistedStack> stackEntry : persisted.stacks.entrySet()) {
                        PersistedStack stack = stackEntry.getValue();
                        if (stackEntry.getKey() == null || stack == null) {
                            continue;
                        }
                        machine.stacks.put(
                            stackEntry.getKey(),
                            new PairSeries(
                                BucketSeries.fromSnapshot(stack.hourly),
                                BucketSeries.fromSnapshot(stack.daily)));
                    }
                }
                machines.put(machineEntry.getKey(), machine);
            }
        }
        if (loaded.stacks != null) {
            for (Map.Entry<String, StackMeta> entry : loaded.stacks.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    stackMeta.put(entry.getKey(), entry.getValue());
                }
            }
        }
    }

    /**
     * In database mode the counters go to the database as they are recorded; machine names, owners and stack
     * names (what {@link #buildSnapshot} still holds, with no buckets) are stored as one meta row.
     */
    private static void importInto(HistoryDb db, PersistedFile loaded) {
        HistoryDb.Import rows = new HistoryDb.Import();
        if (loaded.machines != null) {
            for (Map.Entry<String, PersistedMachine> machineEntry : loaded.machines.entrySet()) {
                PersistedMachine machine = machineEntry.getValue();
                if (machineEntry.getKey() == null || machine == null || machine.stacks == null) {
                    continue;
                }
                for (Map.Entry<String, PersistedStack> stackEntry : machine.stacks.entrySet()) {
                    PersistedStack stack = stackEntry.getValue();
                    if (stackEntry.getKey() == null || stack == null) {
                        continue;
                    }
                    importBuckets(
                        rows,
                        HistoryTable.PRODUCTION_HOURLY,
                        machineEntry.getKey(),
                        stackEntry.getKey(),
                        stack.hourly,
                        HOUR_MILLIS);
                    importBuckets(
                        rows,
                        HistoryTable.PRODUCTION_DAILY,
                        machineEntry.getKey(),
                        stackEntry.getKey(),
                        stack.daily,
                        DAY_MILLIS);
                }
                machine.stacks = new LinkedHashMap<>();
            }
        }
        rows.meta(
            META_NAME,
            GSONUtils.GSON_BUILDER.create()
                .toJson(loaded));
        db.importOnce(
            file.file()
                .getName(),
            rows,
            () -> HistoryDb.keepImportedFile(file.file()));
    }

    private static void importBuckets(HistoryDb.Import rows, HistoryTable table, String machineId, String stackId,
        Map<Long, Long> buckets, long bucketMillis) {
        if (buckets == null) {
            return;
        }
        for (Map.Entry<Long, Long> bucket : buckets.entrySet()) {
            if (bucket.getKey() != null && bucket.getValue() != null && bucket.getValue() > 0) {
                rows.counter(table, machineId, stackId, bucket.getKey() * bucketMillis, bucket.getValue());
            }
        }
    }

    /**
     * Folds the stored names into memory once the database answered; what was recorded since startup wins.
     * Until then nothing is written back, so a partial in-memory view never replaces the stored one.
     */
    private static void mergeMeta(String json) {
        PersistedFile stored = null;
        if (json != null) {
            try {
                stored = GSONUtils.GSON_BUILDER.create()
                    .fromJson(json, PersistedFile.class);
            } catch (RuntimeException e) {
                LOG.error("GregTech production names in the history database are unreadable, starting over", e);
            }
        }
        if (stored != null) {
            if (stored.trackingSinceMillis > 0
                && (trackingSinceMillis == 0L || stored.trackingSinceMillis < trackingSinceMillis)) {
                trackingSinceMillis = stored.trackingSinceMillis;
            }
            if (stored.machines != null) {
                for (Map.Entry<String, PersistedMachine> entry : stored.machines.entrySet()) {
                    if (entry.getKey() == null || entry.getValue() == null) {
                        continue;
                    }
                    MachineProduction machine = machines.computeIfAbsent(entry.getKey(), k -> new MachineProduction());
                    if (machine.name == null) {
                        machine.name = entry.getValue().name;
                    }
                    if (machine.owner == null) {
                        machine.owner = entry.getValue().owner;
                    }
                }
            }
            if (stored.stacks != null) {
                for (Map.Entry<String, StackMeta> entry : stored.stacks.entrySet()) {
                    if (entry.getKey() != null && entry.getValue() != null) {
                        stackMeta.putIfAbsent(entry.getKey(), entry.getValue());
                    }
                }
            }
        }
        metaLoaded = true;
        dirty.set(true);
    }

    static void flushIfDirty() {
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            if (metaLoaded && dirty.compareAndSet(true, false)) {
                db.putMeta(
                    META_NAME,
                    GSONUtils.GSON_BUILDER.create()
                        .toJson(buildSnapshot()));
            }
            return;
        }
        if (dirty.compareAndSet(true, false)) {
            file.saveAsync(buildSnapshot());
        }
    }

    static void saveNow() {
        if (HistoryDb.get() != null) {
            flushIfDirty();
            return;
        }
        dirty.set(false);
        file.saveNow(buildSnapshot());
    }

    static void clear() {
        machines.clear();
        stackMeta.clear();
        trackingSinceMillis = 0L;
        metaLoaded = false;
        dirty.set(false);
    }
}
