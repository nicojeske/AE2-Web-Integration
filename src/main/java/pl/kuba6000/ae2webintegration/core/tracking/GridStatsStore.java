package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;
import pl.kuba6000.ae2webintegration.core.interfaces.GridStats;

/**
 * History of every grid's storage capacity and AE power, sampled with the item statistics and kept in the same two
 * tiers. Byte and type counts are what fills up in a long-running base, so a read also projects when they run out.
 */
public final class GridStatsStore {

    public static final String ITEM_BYTES_USED = "item_bytes_used";
    public static final String ITEM_BYTES_TOTAL = "item_bytes_total";
    public static final String ITEM_TYPES_USED = "item_types_used";
    public static final String ITEM_TYPES_TOTAL = "item_types_total";
    public static final String FLUID_BYTES_USED = "fluid_bytes_used";
    public static final String FLUID_BYTES_TOTAL = "fluid_bytes_total";
    public static final String FLUID_TYPES_USED = "fluid_types_used";
    public static final String FLUID_TYPES_TOTAL = "fluid_types_total";
    /** AE/t, rounded. */
    public static final String POWER_USAGE = "power_usage";
    public static final String POWER_INJECTION = "power_injection";
    public static final String POWER_STORED = "power_stored";
    public static final String POWER_MAX = "power_max";

    static final String[] KEYS = { ITEM_BYTES_USED, ITEM_BYTES_TOTAL, ITEM_TYPES_USED, ITEM_TYPES_TOTAL,
        FLUID_BYTES_USED, FLUID_BYTES_TOTAL, FLUID_TYPES_USED, FLUID_TYPES_TOTAL, POWER_USAGE, POWER_INJECTION,
        POWER_STORED, POWER_MAX };

    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);
    /** A forecast needs this much history to mean anything. */
    static final long MIN_FORECAST_SPAN_MILLIS = TimeUnit.HOURS.toMillis(1);

    private static final ConcurrentHashMap<String, GridStats> latest = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Long> latestMillis = new ConcurrentHashMap<>();

    private GridStatsStore() {}

    // --- Writing (server thread) ---

    public static void sample(String gridKey, @Nullable GridStats stats, long nowMillis) {
        if (stats == null) return;
        latest.put(gridKey, stats);
        latestMillis.put(gridKey, nowMillis);
        HistoryDb db = HistoryDb.get();
        if (db == null) return;
        long fineBucketMillis = fineBucketMillis();
        long fineStart = Math.floorDiv(nowMillis, fineBucketMillis) * fineBucketMillis;
        long hourlyStart = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS) * HOURLY_BUCKET_MILLIS;
        for (Map.Entry<String, Long> metric : values(stats).entrySet()) {
            db.putGauge(HistoryTable.GRID_FINE, gridKey, metric.getKey(), fineStart, metric.getValue());
            db.putGauge(HistoryTable.GRID_HOURLY, gridKey, metric.getKey(), hourlyStart, metric.getValue());
        }
        db.markSampled(HistoryTable.GRID_FINE, gridKey, fineStart, fineBucketMillis);
        db.markSampled(HistoryTable.GRID_HOURLY, gridKey, hourlyStart, HOURLY_BUCKET_MILLIS);
    }

    static Map<String, Long> values(GridStats stats) {
        Map<String, Long> values = new LinkedHashMap<>();
        values.put(ITEM_BYTES_USED, stats.itemBytesUsed());
        values.put(ITEM_BYTES_TOTAL, stats.itemBytesTotal());
        values.put(ITEM_TYPES_USED, stats.itemTypesUsed());
        values.put(ITEM_TYPES_TOTAL, stats.itemTypesTotal());
        values.put(FLUID_BYTES_USED, stats.fluidBytesUsed());
        values.put(FLUID_BYTES_TOTAL, stats.fluidBytesTotal());
        values.put(FLUID_TYPES_USED, stats.fluidTypesUsed());
        values.put(FLUID_TYPES_TOTAL, stats.fluidTypesTotal());
        values.put(POWER_USAGE, Math.round(stats.powerUsage()));
        values.put(POWER_INJECTION, Math.round(stats.powerInjection()));
        values.put(POWER_STORED, Math.round(stats.powerStored()));
        values.put(POWER_MAX, Math.round(stats.powerMax()));
        return values;
    }

    public static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) return;
        db.prune(
            HistoryTable.GRID_FINE,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.fineRetentionDays),
            nowMillis);
        db.prune(
            HistoryTable.GRID_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.hourlyRetentionDays),
            nowMillis);
    }

    public static void clear() {
        latest.clear();
        latestMillis.clear();
    }

    // --- Reading (HTTP threads) ---

    /** Wire shape for {@code /api/grids/{gridKey}/capacity}. Series values: -1 = no sample. */
    public static final class Capacity {

        /** The last sample; null before the first one since startup. */
        public @Nullable GridStats current;
        /** When {@link #current} was sampled, in Unix epoch milliseconds; 0 without one. */
        public long sampledAt;
        public long from;
        public long to;
        public long stepMillis;
        /** {@code fine} or {@code hourly}. */
        public String resolution;
        /** One series per metric, keyed like {@code item_bytes_used}; power in AE (usage per tick). */
        public Map<String, long[]> series = new LinkedHashMap<>();
        /**
         * When item bytes, item types and fluid bytes run out at the range's trend, in Unix epoch milliseconds; null
         * when not growing or too little history.
         */
        public @Nullable Long itemBytesFullAt;
        public @Nullable Long itemTypesFullAt;
        public @Nullable Long fluidBytesFullAt;
    }

    /** Same tiers and downsampling as {@link ItemHistoryStore#readSeries}. */
    public static Capacity read(HistoryDb db, String gridKey, long fromMillis, long toMillis, int maxPoints) {
        Capacity result = new Capacity();
        result.current = latest.get(gridKey);
        result.sampledAt = latestMillis.getOrDefault(gridKey, 0L);
        long span = toMillis - fromMillis;
        boolean useFine = span <= TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.fineRetentionDays);
        long bucketMillis = useFine ? fineBucketMillis() : HOURLY_BUCKET_MILLIS;
        result.resolution = useFine ? "fine" : "hourly";
        long fromBucket = Math.floorDiv(fromMillis, bucketMillis);
        long toBucket = Math.max(fromBucket, Math.floorDiv(toMillis, bucketMillis));
        long totalBuckets = toBucket - fromBucket + 1;
        int cappedMaxPoints = Math.max(1, maxPoints);
        long step = totalBuckets <= cappedMaxPoints ? 1 : (totalBuckets + cappedMaxPoints - 1) / cappedMaxPoints;
        result.from = fromBucket * bucketMillis;
        result.to = toBucket * bucketMillis;
        result.stepMillis = step * bucketMillis;
        HistoryTable table = useFine ? HistoryTable.GRID_FINE : HistoryTable.GRID_HOURLY;
        for (String key : KEYS) {
            result.series.put(key, db.readGauge(table, gridKey, key, fromBucket, toBucket, step, bucketMillis));
        }
        result.itemBytesFullAt = fullAt(result, ITEM_BYTES_USED, ITEM_BYTES_TOTAL);
        result.itemTypesFullAt = fullAt(result, ITEM_TYPES_USED, ITEM_TYPES_TOTAL);
        result.fluidBytesFullAt = fullAt(result, FLUID_BYTES_USED, FLUID_BYTES_TOTAL);
        return result;
    }

    /**
     * Least-squares trend of {@code used} over the range, run forward to the newest {@code total}. Null unless it
     * grows, over at least {@link #MIN_FORECAST_SPAN_MILLIS} of samples.
     */
    static @Nullable Long fullAt(Capacity capacity, String usedKey, String totalKey) {
        long[] used = capacity.series.get(usedKey);
        long[] total = capacity.series.get(totalKey);
        int n = 0;
        double sumT = 0, sumV = 0, sumTT = 0, sumTV = 0;
        long firstT = -1, lastT = -1, lastUsed = -1, lastTotal = -1;
        for (int i = 0; i < used.length; i++) {
            if (used[i] < 0) continue;
            long t = capacity.from + i * capacity.stepMillis;
            // Relative hours keep the sums well inside double precision.
            double x = (t - capacity.from) / (double) HOURLY_BUCKET_MILLIS;
            n++;
            sumT += x;
            sumV += used[i];
            sumTT += x * x;
            sumTV += x * used[i];
            if (firstT < 0) firstT = t;
            lastT = t;
            lastUsed = used[i];
            if (total[i] >= 0) lastTotal = total[i];
        }
        if (n < 3 || lastT - firstT < MIN_FORECAST_SPAN_MILLIS || lastTotal <= lastUsed) return null;
        double denominator = n * sumTT - sumT * sumT;
        if (denominator <= 0) return null;
        double perHour = (n * sumTV - sumT * sumV) / denominator;
        if (perHour <= 0) return null;
        double hours = (lastTotal - lastUsed) / perHour;
        if (hours > TimeUnit.DAYS.toHours(3650)) return null;
        return lastT + Math.round(hours * HOURLY_BUCKET_MILLIS);
    }

    private static long fineBucketMillis() {
        return TimeUnit.MINUTES.toMillis(Config.INSTANCE.statistics.sampleIntervalMinutes);
    }
}
