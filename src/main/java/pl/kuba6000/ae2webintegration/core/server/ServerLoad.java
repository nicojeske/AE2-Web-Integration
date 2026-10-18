package pl.kuba6000.ae2webintegration.core.server;

import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * Server tick rate, measured from the platform's tick events: ticks per second, mean milliseconds per tick (the
 * time between a tick's start and end events) and the longest tick, per {@link #WINDOW_MILLIS} window. Every
 * window becomes one fine row and updates its hour's row, which holds the hour so far. Lag explains slow crafts and
 * idle machines, so the analyses show it next to their own numbers.
 * <p>
 * Server thread only, apart from {@link #latest}.
 */
public final class ServerLoad {

    public static final long WINDOW_MILLIS = TimeUnit.SECONDS.toMillis(30);
    static final long HOUR_MILLIS = TimeUnit.HOURS.toMillis(1);
    /** Fine rows are kept this long; the hourly ones as long as the hourly item statistics. */
    static final long FINE_RETENTION_MILLIS = TimeUnit.DAYS.toMillis(7);

    public static final String SCOPE = "server";
    /** Ticks per second, times 100. */
    public static final String TPS = "tps_x100";
    /** Mean tick time in microseconds; absent when the platform reports no tick start. */
    public static final String MSPT = "mspt_us";
    /** Longest gap between two tick ends, in milliseconds. */
    public static final String MAX_TICK = "max_tick_ms";

    private ServerLoad() {}

    /** Totals over one window or hour. */
    static final class Totals {

        long startMillis;
        long ticks;
        long elapsedNanos;
        long busyNanos;
        long busyTicks;
        long maxGapNanos;

        void add(Totals other) {
            ticks += other.ticks;
            elapsedNanos += other.elapsedNanos;
            busyNanos += other.busyNanos;
            busyTicks += other.busyTicks;
            maxGapNanos = Math.max(maxGapNanos, other.maxGapNanos);
        }

        long tpsX100() {
            return elapsedNanos <= 0 ? 0 : Math.round(ticks * 100.0 * TimeUnit.SECONDS.toNanos(1) / elapsedNanos);
        }

        long msptMicros() {
            return busyTicks == 0 ? -1 : TimeUnit.NANOSECONDS.toMicros(busyNanos / busyTicks);
        }

        long maxTickMillis() {
            return TimeUnit.NANOSECONDS.toMillis(maxGapNanos);
        }
    }

    /** One finished window, for the current value shown next to the charts. */
    public static final class Sample {

        public final long atMillis;
        public final double tps;
        /** {@code null} when the platform reports no tick start. */
        public final @Nullable Double mspt;
        public final long maxTickMillis;

        Sample(Totals totals, long atMillis) {
            this.atMillis = atMillis;
            this.tps = totals.tpsX100() / 100.0;
            long micros = totals.msptMicros();
            this.mspt = micros < 0 ? null : micros / 1000.0;
            this.maxTickMillis = totals.maxTickMillis();
        }
    }

    private static Totals window;
    private static Totals hour;
    private static long lastEndNanos;
    private static long tickStartNanos;
    private static volatile @Nullable Sample latest;

    public static @Nullable Sample latest() {
        return latest;
    }

    public static void onTickStart(long nowNanos) {
        tickStartNanos = nowNanos;
    }

    public static void onTickEnd(long nowNanos, long nowMillis) {
        if (lastEndNanos == 0L) {
            // The first tick only starts the clock: there is no previous end to measure from.
            lastEndNanos = nowNanos;
            tickStartNanos = 0L;
            window = newTotals(nowMillis);
            return;
        }
        long gap = nowNanos - lastEndNanos;
        lastEndNanos = nowNanos;
        window.ticks++;
        window.elapsedNanos += gap;
        window.maxGapNanos = Math.max(window.maxGapNanos, gap);
        if (tickStartNanos != 0L) {
            window.busyNanos += nowNanos - tickStartNanos;
            window.busyTicks++;
            tickStartNanos = 0L;
        }
        if (nowMillis - window.startMillis >= WINDOW_MILLIS) {
            flush(nowMillis);
        }
    }

    private static void flush(long nowMillis) {
        Totals done = window;
        window = newTotals(nowMillis);
        latest = new Sample(done, nowMillis);
        long hourStart = Math.floorDiv(done.startMillis, HOUR_MILLIS) * HOUR_MILLIS;
        if (hour == null || hour.startMillis != hourStart) hour = newTotals(hourStart);
        hour.add(done);

        HistoryDb db = HistoryDb.get();
        if (db == null) return;
        long fineStart = Math.floorDiv(done.startMillis, WINDOW_MILLIS) * WINDOW_MILLIS;
        write(db, HistoryTable.SERVER_FINE, fineStart, done);
        write(db, HistoryTable.SERVER_HOURLY, hourStart, hour);
        db.prune(HistoryTable.SERVER_FINE, nowMillis - FINE_RETENTION_MILLIS, nowMillis);
        db.prune(
            HistoryTable.SERVER_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.hourlyRetentionDays),
            nowMillis);
    }

    private static void write(HistoryDb db, HistoryTable table, long bucketStart, Totals totals) {
        db.putGauge(table, SCOPE, TPS, bucketStart, totals.tpsX100());
        long mspt = totals.msptMicros();
        if (mspt >= 0) db.putGauge(table, SCOPE, MSPT, bucketStart, mspt);
        db.putGauge(table, SCOPE, MAX_TICK, bucketStart, totals.maxTickMillis());
    }

    private static Totals newTotals(long startMillis) {
        Totals totals = new Totals();
        totals.startMillis = startMillis;
        return totals;
    }

    /** Wire shape for {@code /api/server/tick-rate}. -1 = no sample in that window. */
    public static final class Series {

        public long from;
        public long to;
        public long stepMillis;
        /** {@code fine} (30 s windows) or {@code hourly}. */
        public String resolution;
        /** Mean ticks per second of each window. */
        public double[] tps;
        /** Mean milliseconds per tick of each window; -1 also when the platform reports no tick start. */
        public double[] mspt;
        /** Longest tick of each window, in milliseconds. */
        public long[] maxTickMillis;
        /** The last finished 30 s window: ticks per second; -1 before the first one. */
        public double currentTps = -1;
        /** The last finished 30 s window: milliseconds per tick; -1 when unknown. */
        public double currentMspt = -1;
    }

    /** Fine rows up to this span, hourly beyond, so a read stays a few thousand rows. */
    static final long FINE_READ_LIMIT_MILLIS = TimeUnit.DAYS.toMillis(2);

    /**
     * {@code [from, to)} in at most {@code maxPoints} windows: mean tick rate and tick time, longest tick - so a
     * downsampled lag spike still shows.
     */
    public static Series read(HistoryDb db, long from, long to, int maxPoints) {
        boolean fine = to - from <= FINE_READ_LIMIT_MILLIS;
        long bucket = fine ? WINDOW_MILLIS : HOUR_MILLIS;
        HistoryTable table = fine ? HistoryTable.SERVER_FINE : HistoryTable.SERVER_HOURLY;
        long fromBucket = Math.floorDiv(from, bucket);
        long toBucket = Math.max(fromBucket, Math.floorDiv(to - 1, bucket));
        long[] tps = db.readGauge(table, SCOPE, TPS, fromBucket, toBucket, 1, bucket);
        long[] mspt = db.readGauge(table, SCOPE, MSPT, fromBucket, toBucket, 1, bucket);
        long[] maxTick = db.readGauge(table, SCOPE, MAX_TICK, fromBucket, toBucket, 1, bucket);

        int buckets = tps.length;
        int step = Math.max(1, (buckets + Math.max(1, maxPoints) - 1) / Math.max(1, maxPoints));
        int windows = (buckets + step - 1) / step;
        Series series = new Series();
        series.resolution = fine ? "fine" : "hourly";
        series.from = fromBucket * bucket;
        series.to = (fromBucket + (long) (windows - 1) * step) * bucket;
        series.stepMillis = step * bucket;
        series.tps = new double[windows];
        series.mspt = new double[windows];
        series.maxTickMillis = new long[windows];
        for (int w = 0; w < windows; w++) {
            long tpsSum = 0, msptSum = 0, worst = -1;
            int tpsCount = 0, msptCount = 0;
            for (int i = w * step; i < Math.min(buckets, (w + 1) * step); i++) {
                if (tps[i] >= 0) {
                    tpsSum += tps[i];
                    tpsCount++;
                }
                if (mspt[i] >= 0) {
                    msptSum += mspt[i];
                    msptCount++;
                }
                worst = Math.max(worst, maxTick[i]);
            }
            series.tps[w] = tpsCount == 0 ? -1 : tpsSum / (tpsCount * 100.0);
            series.mspt[w] = msptCount == 0 ? -1 : msptSum / (msptCount * 1000.0);
            series.maxTickMillis[w] = worst;
        }
        Sample current = latest;
        if (current != null) {
            series.currentTps = current.tps;
            series.currentMspt = current.mspt == null ? -1 : current.mspt;
        }
        return series;
    }

    /** Forgets the running windows, so a restarted server does not count its downtime as one long tick. */
    public static void reset() {
        window = null;
        hour = null;
        lastEndNanos = 0L;
        tickStartNanos = 0L;
        latest = null;
    }
}
