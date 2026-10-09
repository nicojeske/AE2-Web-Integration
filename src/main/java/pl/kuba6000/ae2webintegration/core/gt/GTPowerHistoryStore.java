package pl.kuba6000.ae2webintegration.core.gt;

import java.math.BigInteger;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * Latest state plus two-tier history (fine at {@code gt_power_sample_interval_seconds}, hourly) for every
 * power source. The history lives in the history database and only exists while one is configured.
 * <p>
 * History values are longs saturated at {@link Long#MAX_VALUE} - good enough for a chart. The exact
 * {@link BigInteger} is only ever needed for the current value and the net rate, both of which come from
 * memory ({@link #latest} and a short window of exact recent samples).
 */
public final class GTPowerHistoryStore {

    /** Series keys of one power source in the history database. */
    private static final String STORED = "stored";
    private static final String AVG_IN = "avg_in";
    private static final String AVG_OUT = "avg_out";

    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);
    /** Window the stored-delta rate is computed over, for sources that do not report their own averages. */
    static final long RATE_WINDOW_MILLIS = TimeUnit.MINUTES.toMillis(5);

    private GTPowerHistoryStore() {}

    /** Exact recent samples of one source for the rate; runtime only. */
    private static final class RateWindow {

        final Deque<Long> recentMillis = new ArrayDeque<>();
        final Deque<BigInteger> recentStored = new ArrayDeque<>();
    }

    private static final ConcurrentHashMap<String, GTPowerSourceSnapshot> latest = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Long> latestMillis = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, RateWindow> rateWindows = new ConcurrentHashMap<>();

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
            RateWindow window = rateWindows.computeIfAbsent(source.id, k -> new RateWindow());
            synchronized (window) {
                window.recentMillis.addLast(nowMillis);
                window.recentStored.addLast(source.stored);
                while (window.recentMillis.size() > 1
                    && nowMillis - window.recentMillis.peekFirst() > RATE_WINDOW_MILLIS) {
                    window.recentMillis.removeFirst();
                    window.recentStored.removeFirst();
                }
            }
        }
    }

    /** At the power sample interval: one history point per source currently in {@link #latest}'s scan. */
    static void recordSample(List<GTPowerSourceSnapshot> sources, long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (sources == null || db == null) {
            return;
        }
        long fineStart = Math.floorDiv(nowMillis, fineBucketMillis()) * fineBucketMillis();
        long hourlyStart = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS) * HOURLY_BUCKET_MILLIS;
        for (GTPowerSourceSnapshot source : sources) {
            if (source == null || source.id == null) {
                continue;
            }
            long stored = saturate(source.stored);
            db.putGauge(HistoryTable.POWER_FINE, source.id, STORED, fineStart, stored);
            db.putGauge(HistoryTable.POWER_HOURLY, source.id, STORED, hourlyStart, stored);
            if (source.avgInPerTick != null) {
                long in = Math.max(0, source.avgInPerTick);
                db.putGauge(HistoryTable.POWER_FINE, source.id, AVG_IN, fineStart, in);
                db.putGauge(HistoryTable.POWER_HOURLY, source.id, AVG_IN, hourlyStart, in);
            }
            if (source.avgOutPerTick != null) {
                long out = Math.max(0, source.avgOutPerTick);
                db.putGauge(HistoryTable.POWER_FINE, source.id, AVG_OUT, fineStart, out);
                db.putGauge(HistoryTable.POWER_HOURLY, source.id, AVG_OUT, hourlyStart, out);
            }
        }
    }

    static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return;
        }
        db.prune(
            HistoryTable.POWER_FINE,
            nowMillis - TimeUnit.HOURS.toMillis(Config.INSTANCE.gregtech.powerFineRetentionHours),
            nowMillis);
        db.prune(
            HistoryTable.POWER_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.powerHourlyRetentionDays),
            nowMillis);
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
        RateWindow window = rateWindows.get(source.id);
        if (window == null) {
            return null;
        }
        synchronized (window) {
            if (window.recentMillis.size() < 2) {
                return null;
            }
            long elapsedMillis = window.recentMillis.peekLast() - window.recentMillis.peekFirst();
            if (elapsedMillis <= 0) {
                return null;
            }
            BigInteger delta = window.recentStored.peekLast()
                .subtract(window.recentStored.peekFirst());
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
    public static Series read(HistoryDb db, String sourceId, long fromMillis, long toMillis, int maxPoints) {
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

        HistoryTable table = useFine ? HistoryTable.POWER_FINE : HistoryTable.POWER_HOURLY;
        series.stored = db.readGauge(table, sourceId, STORED, fromBucket, toBucket, step, tierBucketMillis);
        series.avgIn = db.readGauge(table, sourceId, AVG_IN, fromBucket, toBucket, step, tierBucketMillis);
        series.avgOut = db.readGauge(table, sourceId, AVG_OUT, fromBucket, toBucket, step, tierBucketMillis);
        return series;
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

    static void clear() {
        rateWindows.clear();
        latest.clear();
        latestMillis.clear();
    }
}
