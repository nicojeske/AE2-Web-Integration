package pl.kuba6000.ae2webintegration.core.gt;

import java.math.BigInteger;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * Latest state plus two-tier history (fine at {@code gt_power_sample_interval_seconds}, hourly) for every
 * power source, persisted to {@code gtpower.json}.
 * <p>
 * History values are longs saturated at {@link Long#MAX_VALUE} - good enough for a chart, and it keeps the
 * file plain. The exact {@link BigInteger} is only ever needed for the current value and the net rate, both
 * of which come from memory ({@link #latest} and a short window of exact recent samples).
 */
public final class GTPowerHistoryStore {

    public static final long NO_SAMPLE = -1L;

    /** Series keys of one power source in the history database. */
    private static final String STORED = "stored";
    private static final String AVG_IN = "avg_in";
    private static final String AVG_OUT = "avg_out";

    private static final int SCHEMA_VERSION = 1;
    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);
    /** Window the stored-delta rate is computed over, for sources that do not report their own averages. */
    static final long RATE_WINDOW_MILLIS = TimeUnit.MINUTES.toMillis(5);

    private GTPowerHistoryStore() {}

    private static final class SourceHistory {

        final BucketSeries fineStored;
        final BucketSeries fineIn;
        final BucketSeries fineOut;
        final BucketSeries hourlyStored;
        final BucketSeries hourlyIn;
        final BucketSeries hourlyOut;
        /** Exact recent samples for the rate; runtime only. */
        final Deque<Long> recentMillis = new ArrayDeque<>();
        final Deque<BigInteger> recentStored = new ArrayDeque<>();

        SourceHistory(BucketSeries fineStored, BucketSeries fineIn, BucketSeries fineOut, BucketSeries hourlyStored,
            BucketSeries hourlyIn, BucketSeries hourlyOut) {
            this.fineStored = fineStored;
            this.fineIn = fineIn;
            this.fineOut = fineOut;
            this.hourlyStored = hourlyStored;
            this.hourlyIn = hourlyIn;
            this.hourlyOut = hourlyOut;
        }

        SourceHistory() {
            this(
                new BucketSeries(),
                new BucketSeries(),
                new BucketSeries(),
                new BucketSeries(),
                new BucketSeries(),
                new BucketSeries());
        }
    }

    private static final ConcurrentHashMap<String, GTPowerSourceSnapshot> latest = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Long> latestMillis = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, SourceHistory> histories = new ConcurrentHashMap<>();
    private static final AtomicBoolean dirty = new AtomicBoolean(false);
    private static final GTJsonFile<PersistedFile> file = new GTJsonFile<>("gtpower.json", PersistedFile.class);

    // --- Writing (server thread) ---

    /** Every scan: refreshes the current value and the exact rate window. Cheap, no history written. */
    static void updateLatest(List<GTPowerSourceSnapshot> sources, long nowMillis) {
        if (sources == null) {
            return;
        }
        for (GTPowerSourceSnapshot source : sources) {
            if (source == null || source.id == null) {
                continue;
            }
            if (source.stored == null) {
                source.stored = BigInteger.ZERO;
            }
            latest.put(source.id, source);
            latestMillis.put(source.id, nowMillis);
            SourceHistory history = histories.computeIfAbsent(source.id, k -> new SourceHistory());
            synchronized (history) {
                history.recentMillis.addLast(nowMillis);
                history.recentStored.addLast(source.stored);
                while (history.recentMillis.size() > 1
                    && nowMillis - history.recentMillis.peekFirst() > RATE_WINDOW_MILLIS) {
                    history.recentMillis.removeFirst();
                    history.recentStored.removeFirst();
                }
            }
        }
    }

    /** At the power sample interval: one history point per source currently in {@link #latest}'s scan. */
    static void recordSample(List<GTPowerSourceSnapshot> sources, long nowMillis) {
        if (sources == null) {
            return;
        }
        long fineBucket = Math.floorDiv(nowMillis, fineBucketMillis());
        long hourlyBucket = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS);
        HistoryDb db = HistoryDb.get();
        for (GTPowerSourceSnapshot source : sources) {
            if (source == null || source.id == null) {
                continue;
            }
            if (db != null) {
                recordSample(db, source, fineBucket * fineBucketMillis(), hourlyBucket * HOURLY_BUCKET_MILLIS);
                continue;
            }
            SourceHistory history = histories.computeIfAbsent(source.id, k -> new SourceHistory());
            long stored = saturate(source.stored);
            history.fineStored.set(fineBucket, stored);
            history.hourlyStored.set(hourlyBucket, stored);
            if (source.avgInPerTick != null) {
                history.fineIn.set(fineBucket, Math.max(0, source.avgInPerTick));
                history.hourlyIn.set(hourlyBucket, Math.max(0, source.avgInPerTick));
            }
            if (source.avgOutPerTick != null) {
                history.fineOut.set(fineBucket, Math.max(0, source.avgOutPerTick));
                history.hourlyOut.set(hourlyBucket, Math.max(0, source.avgOutPerTick));
            }
        }
        dirty.set(true);
    }

    private static void recordSample(HistoryDb db, GTPowerSourceSnapshot source, long fineStart, long hourlyStart) {
        long stored = saturate(source.stored);
        db.putGauge(HistoryTable.POWER_FINE, source.id, STORED, fineStart, stored);
        db.putGauge(HistoryTable.POWER_HOURLY, source.id, STORED, hourlyStart, stored);
        if (source.avgInPerTick != null) {
            db.putGauge(HistoryTable.POWER_FINE, source.id, AVG_IN, fineStart, Math.max(0, source.avgInPerTick));
            db.putGauge(HistoryTable.POWER_HOURLY, source.id, AVG_IN, hourlyStart, Math.max(0, source.avgInPerTick));
        }
        if (source.avgOutPerTick != null) {
            db.putGauge(HistoryTable.POWER_FINE, source.id, AVG_OUT, fineStart, Math.max(0, source.avgOutPerTick));
            db.putGauge(HistoryTable.POWER_HOURLY, source.id, AVG_OUT, hourlyStart, Math.max(0, source.avgOutPerTick));
        }
    }

    static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            db.prune(
                HistoryTable.POWER_FINE,
                nowMillis - TimeUnit.HOURS.toMillis(Config.INSTANCE.gregtech.powerFineRetentionHours),
                nowMillis);
            db.prune(
                HistoryTable.POWER_HOURLY,
                nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.powerHourlyRetentionDays),
                nowMillis);
        }
        long minFine = Math.floorDiv(
            nowMillis - TimeUnit.HOURS.toMillis(Config.INSTANCE.gregtech.powerFineRetentionHours),
            fineBucketMillis());
        long minHourly = Math.floorDiv(
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.powerHourlyRetentionDays),
            HOURLY_BUCKET_MILLIS);
        for (Map.Entry<String, SourceHistory> entry : histories.entrySet()) {
            SourceHistory h = entry.getValue();
            boolean changed = h.fineStored.prune(minFine) | h.fineIn.prune(minFine)
                | h.fineOut.prune(minFine)
                | h.hourlyStored.prune(minHourly)
                | h.hourlyIn.prune(minHourly)
                | h.hourlyOut.prune(minHourly);
            if (changed) {
                dirty.set(true);
            }
            if (h.hourlyStored.isEmpty() && h.fineStored.isEmpty() && !latest.containsKey(entry.getKey())) {
                histories.remove(entry.getKey());
                dirty.set(true);
            }
        }
    }

    // --- Reading (HTTP threads) ---

    public static Collection<GTPowerSourceSnapshot> latest() {
        return latest.values();
    }

    public static GTPowerSourceSnapshot latest(String sourceId) {
        return sourceId == null ? null : latest.get(sourceId);
    }

    public static long latestMillis(String sourceId) {
        Long millis = latestMillis.get(sourceId);
        return millis == null ? 0L : millis;
    }

    /**
     * Net EU/t: the source's own averages when it reports both, otherwise the change in stored EU over the
     * exact samples of the last {@link #RATE_WINDOW_MILLIS}. {@code null} when neither is available yet
     * (a wireless network seen in fewer than two scans).
     */
    public static Long netPerTick(GTPowerSourceSnapshot source) {
        if (source.avgInPerTick != null && source.avgOutPerTick != null) {
            return source.avgInPerTick - source.avgOutPerTick;
        }
        SourceHistory history = histories.get(source.id);
        if (history == null) {
            return null;
        }
        synchronized (history) {
            if (history.recentMillis.size() < 2) {
                return null;
            }
            long elapsedMillis = history.recentMillis.peekLast() - history.recentMillis.peekFirst();
            if (elapsedMillis <= 0) {
                return null;
            }
            BigInteger delta = history.recentStored.peekLast()
                .subtract(history.recentStored.peekFirst());
            // 50 ms per tick: EU/t = delta * 50 / elapsedMillis.
            return saturate(
                delta.multiply(BigInteger.valueOf(50))
                    .divide(BigInteger.valueOf(elapsedMillis)));
        }
    }

    /** Wire shape for {@code /api/gt/power/{sourceId}/history}. -1 = no sample in that window. */
    public static final class Series {

        public String source;
        public long from;
        public long to;
        public long stepMillis;
        public String resolution;
        public long[] stored;
        public long[] avgIn;
        public long[] avgOut;
    }

    /** Same tier choice and downsampling as {@code ItemHistoryStore.readSeries}: newest sample per window. */
    public static Series read(String sourceId, long fromMillis, long toMillis, int maxPoints) {
        long fromClamped = Math.min(fromMillis, toMillis);
        long toClamped = Math.max(fromMillis, toMillis);
        boolean useFine = toClamped - fromClamped
            <= TimeUnit.HOURS.toMillis(Config.INSTANCE.gregtech.powerFineRetentionHours);
        long tierBucketMillis = useFine ? fineBucketMillis() : HOURLY_BUCKET_MILLIS;

        long fromBucket = Math.floorDiv(fromClamped, tierBucketMillis);
        long toBucket = Math.max(fromBucket, Math.floorDiv(toClamped, tierBucketMillis));
        long totalBuckets = toBucket - fromBucket + 1;
        int cappedMaxPoints = Math.max(1, maxPoints);
        long step = totalBuckets <= cappedMaxPoints ? 1 : (totalBuckets + cappedMaxPoints - 1) / cappedMaxPoints;

        Series series = new Series();
        series.source = sourceId;
        series.resolution = useFine ? "fine" : "hourly";
        series.from = fromBucket * tierBucketMillis;
        series.to = toBucket * tierBucketMillis;
        series.stepMillis = step * tierBucketMillis;

        HistoryDb db = HistoryDb.get();
        if (db != null) {
            HistoryTable table = useFine ? HistoryTable.POWER_FINE : HistoryTable.POWER_HOURLY;
            series.stored = db.readGauge(table, sourceId, STORED, fromBucket, toBucket, step, tierBucketMillis);
            series.avgIn = db.readGauge(table, sourceId, AVG_IN, fromBucket, toBucket, step, tierBucketMillis);
            series.avgOut = db.readGauge(table, sourceId, AVG_OUT, fromBucket, toBucket, step, tierBucketMillis);
            return series;
        }
        SourceHistory history = histories.get(sourceId);
        series.stored = downsample(
            history == null ? null : (useFine ? history.fineStored : history.hourlyStored),
            fromBucket,
            toBucket,
            step);
        series.avgIn = downsample(
            history == null ? null : (useFine ? history.fineIn : history.hourlyIn),
            fromBucket,
            toBucket,
            step);
        series.avgOut = downsample(
            history == null ? null : (useFine ? history.fineOut : history.hourlyOut),
            fromBucket,
            toBucket,
            step);
        return series;
    }

    private static long[] downsample(BucketSeries ring, long fromBucket, long toBucket, long step) {
        List<Long> points = new ArrayList<>();
        for (long windowStart = fromBucket; windowStart <= toBucket; windowStart += step) {
            long windowEnd = Math.min(windowStart + step - 1, toBucket);
            points.add(ring == null ? NO_SAMPLE : ring.newest(windowStart, windowEnd, NO_SAMPLE));
        }
        long[] values = new long[points.size()];
        for (int i = 0; i < values.length; i++) {
            values[i] = points.get(i);
        }
        return values;
    }

    private static long fineBucketMillis() {
        return TimeUnit.SECONDS.toMillis(Config.INSTANCE.gregtech.powerSampleIntervalSeconds);
    }

    static long saturate(BigInteger value) {
        if (value == null) {
            return 0L;
        }
        if (value.bitLength() < 64) {
            return value.longValue();
        }
        return value.signum() < 0 ? Long.MIN_VALUE : Long.MAX_VALUE;
    }

    // --- Persistence ---

    private static final class PersistedSource {

        long fineBucketMillis;
        TreeMap<Long, Long> fineStored;
        TreeMap<Long, Long> fineIn;
        TreeMap<Long, Long> fineOut;
        TreeMap<Long, Long> hourlyStored;
        TreeMap<Long, Long> hourlyIn;
        TreeMap<Long, Long> hourlyOut;
    }

    private static final class PersistedFile {

        int schemaVersion = SCHEMA_VERSION;
        Map<String, PersistedSource> sources = new LinkedHashMap<>();
    }

    private static PersistedFile buildSnapshot() {
        PersistedFile snapshot = new PersistedFile();
        for (Map.Entry<String, SourceHistory> entry : histories.entrySet()) {
            SourceHistory h = entry.getValue();
            PersistedSource persisted = new PersistedSource();
            persisted.fineBucketMillis = fineBucketMillis();
            persisted.fineStored = h.fineStored.snapshot();
            persisted.fineIn = h.fineIn.snapshot();
            persisted.fineOut = h.fineOut.snapshot();
            persisted.hourlyStored = h.hourlyStored.snapshot();
            persisted.hourlyIn = h.hourlyIn.snapshot();
            persisted.hourlyOut = h.hourlyOut.snapshot();
            snapshot.sources.put(entry.getKey(), persisted);
        }
        return snapshot;
    }

    static void loadData() {
        histories.clear();
        latest.clear();
        latestMillis.clear();
        PersistedFile loaded = file.load();
        if (loaded == null || loaded.sources == null) {
            return;
        }
        HistoryDb db = HistoryDb.get();
        if (db != null) {
            importInto(db, loaded);
            return;
        }
        for (Map.Entry<String, PersistedSource> entry : loaded.sources.entrySet()) {
            PersistedSource p = entry.getValue();
            if (entry.getKey() == null || p == null) {
                continue;
            }
            // A changed sample interval renumbers the fine buckets; drop that tier rather than misplace it.
            boolean fineMatches = p.fineBucketMillis == fineBucketMillis();
            histories.put(
                entry.getKey(),
                new SourceHistory(
                    fineMatches ? BucketSeries.fromSnapshot(p.fineStored) : new BucketSeries(),
                    fineMatches ? BucketSeries.fromSnapshot(p.fineIn) : new BucketSeries(),
                    fineMatches ? BucketSeries.fromSnapshot(p.fineOut) : new BucketSeries(),
                    BucketSeries.fromSnapshot(p.hourlyStored),
                    BucketSeries.fromSnapshot(p.hourlyIn),
                    BucketSeries.fromSnapshot(p.hourlyOut)));
        }
    }

    /** One-time move of {@code gtpower.json} into the history database; the file is kept, renamed. */
    private static void importInto(HistoryDb db, PersistedFile loaded) {
        HistoryDb.Import rows = new HistoryDb.Import();
        for (Map.Entry<String, PersistedSource> entry : loaded.sources.entrySet()) {
            PersistedSource p = entry.getValue();
            if (entry.getKey() == null || p == null) {
                continue;
            }
            String id = entry.getKey();
            // Bucket numbers are converted with the interval they were written with, so no tier is lost here.
            importBuckets(rows, HistoryTable.POWER_FINE, id, STORED, p.fineStored, p.fineBucketMillis);
            importBuckets(rows, HistoryTable.POWER_FINE, id, AVG_IN, p.fineIn, p.fineBucketMillis);
            importBuckets(rows, HistoryTable.POWER_FINE, id, AVG_OUT, p.fineOut, p.fineBucketMillis);
            importBuckets(rows, HistoryTable.POWER_HOURLY, id, STORED, p.hourlyStored, HOURLY_BUCKET_MILLIS);
            importBuckets(rows, HistoryTable.POWER_HOURLY, id, AVG_IN, p.hourlyIn, HOURLY_BUCKET_MILLIS);
            importBuckets(rows, HistoryTable.POWER_HOURLY, id, AVG_OUT, p.hourlyOut, HOURLY_BUCKET_MILLIS);
        }
        db.importOnce(
            file.file()
                .getName(),
            rows,
            () -> HistoryDb.keepImportedFile(file.file()));
    }

    private static void importBuckets(HistoryDb.Import rows, HistoryTable table, String sourceId, String key,
        Map<Long, Long> buckets, long bucketMillis) {
        if (buckets == null || bucketMillis <= 0) {
            return;
        }
        for (Map.Entry<Long, Long> bucket : buckets.entrySet()) {
            if (bucket.getKey() != null && bucket.getValue() != null) {
                rows.gauge(table, sourceId, key, bucket.getKey() * bucketMillis, bucket.getValue());
            }
        }
    }

    static void flushIfDirty() {
        if (HistoryDb.get() != null) {
            return;
        }
        if (dirty.compareAndSet(true, false)) {
            file.saveAsync(buildSnapshot());
        }
    }

    static void saveNow() {
        if (HistoryDb.get() != null) {
            return;
        }
        dirty.set(false);
        file.saveNow(buildSnapshot());
    }

    static void clear() {
        histories.clear();
        latest.clear();
        latestMillis.clear();
        dirty.set(false);
    }
}
