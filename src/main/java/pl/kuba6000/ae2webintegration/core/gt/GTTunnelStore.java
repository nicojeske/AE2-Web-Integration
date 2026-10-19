package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.api.gt.GTEnergyTunnelSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * Throughput of every EU P2P tunnel, worked out from the running counters the provider reads off each input part:
 * the change between two scans over the ticks between them. Ticks, not wall time, so lag doesn't skew the rate.
 * <p>
 * The current rate is the average over the last {@link #RATE_WINDOW_MILLIS}, the peak the busiest single scan in
 * that window, and the share of ticks the line feeding it was maxed out. History shares the power tables ({@code scope}
 * = tunnel id): average and peak EU/t and the per-mille of ticks maxed, per fine and per hourly bucket. Amps are EU/t
 * divided
 * by the tunnel's voltage.
 */
public final class GTTunnelStore {

    /** Series keys of one tunnel in the history database. */
    private static final String EU_T = "eu_t";
    private static final String PEAK_EU_T = "peak_eu_t";
    private static final String MAXED_PERMILLE = "maxed_permille";

    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);
    static final long RATE_WINDOW_MILLIS = TimeUnit.MINUTES.toMillis(5);
    private static final int TICKS_PER_SECOND = 20;

    private GTTunnelStore() {}

    /** Counter changes over one stretch of ticks. */
    private static final class Interval {

        final long endMillis;
        final long ticks;
        final long eu;
        final long packets;
        final long maxed;

        Interval(long endMillis, long ticks, long eu, long packets, long maxed) {
            this.endMillis = endMillis;
            this.ticks = ticks;
            this.eu = eu;
            this.packets = packets;
            this.maxed = Math.min(maxed, ticks);
        }
    }

    /** Sums of several intervals, plus the busiest one; one per history bucket being filled. */
    private static final class Accumulator {

        long bucketStart = Long.MIN_VALUE;
        long ticks;
        long eu;
        long maxed;
        double peakEuPerTick;

        void add(Interval interval) {
            ticks += interval.ticks;
            eu += interval.eu;
            maxed += interval.maxed;
            peakEuPerTick = Math.max(peakEuPerTick, (double) interval.eu / interval.ticks);
        }

        void reset(long start) {
            bucketStart = start;
            ticks = 0;
            eu = 0;
            maxed = 0;
            peakEuPerTick = 0;
        }
    }

    /** Server-thread state of one tunnel. */
    private static final class Tracker {

        GTEnergyTunnelSnapshot previous;
        long previousTick;
        final Deque<Interval> window = new ArrayDeque<>();
        final Accumulator fine = new Accumulator();
        final Accumulator hourly = new Accumulator();
    }

    /** What the HTTP threads read: the latest snapshot and the rates as of that scan. */
    public static final class View {

        public final GTEnergyTunnelSnapshot snapshot;
        public final long sampledAt;
        /** Average over the window; {@code null} until two scans in a row saw the tunnel. */
        public final Double euPerTick;
        public final Double peakEuPerTick;
        /** 0..1: share of the window's ticks the line was maxed out. */
        public final Double maxedShare;

        View(GTEnergyTunnelSnapshot snapshot, long sampledAt, Double euPerTick, Double peakEuPerTick,
            Double maxedShare) {
            this.snapshot = snapshot;
            this.sampledAt = sampledAt;
            this.euPerTick = euPerTick;
            this.peakEuPerTick = peakEuPerTick;
            this.maxedShare = maxedShare;
        }
    }

    private static final ConcurrentHashMap<String, Tracker> trackers = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, View> views = new ConcurrentHashMap<>();

    // --- Writing (server thread) ---

    /** Every scan: turns the counter changes since the last scan into rates. */
    static void update(List<GTEnergyTunnelSnapshot> tunnels, long nowMillis, long tickCount) {
        if (tunnels == null) {
            return;
        }
        long scanTicks = (long) Config.INSTANCE.gregtech.scanIntervalSeconds * TICKS_PER_SECOND;
        for (GTEnergyTunnelSnapshot tunnel : tunnels) {
            if (tunnel == null || tunnel.id == null) {
                continue;
            }
            Tracker tracker = trackers.computeIfAbsent(tunnel.id, k -> new Tracker());
            GTEnergyTunnelSnapshot previous = tracker.previous;
            long ticks = tickCount - tracker.previousTick;
            // Missed a scan or more (unloaded meanwhile), or the counters restarted with a reloaded part: there is
            // no telling what happened in between, so start over from here.
            if (previous != null && ticks > 0
                && ticks <= 2 * scanTicks
                && tunnel.euAccepted >= previous.euAccepted
                && tunnel.packetsAccepted >= previous.packetsAccepted
                && tunnel.ticksMaxed >= previous.ticksMaxed) {
                Interval interval = new Interval(
                    nowMillis,
                    ticks,
                    tunnel.euAccepted - previous.euAccepted,
                    tunnel.packetsAccepted - previous.packetsAccepted,
                    tunnel.ticksMaxed - previous.ticksMaxed);
                tracker.window.addLast(interval);
                tracker.fine.add(interval);
                long hourStart = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS) * HOURLY_BUCKET_MILLIS;
                if (tracker.hourly.bucketStart != hourStart) {
                    tracker.hourly.reset(hourStart);
                }
                tracker.hourly.add(interval);
            }
            while (!tracker.window.isEmpty() && nowMillis - tracker.window.peekFirst().endMillis > RATE_WINDOW_MILLIS) {
                tracker.window.removeFirst();
            }
            tracker.previous = tunnel;
            tracker.previousTick = tickCount;
            views.put(tunnel.id, view(tunnel, nowMillis, tracker.window));
        }
    }

    private static View view(GTEnergyTunnelSnapshot tunnel, long nowMillis, Deque<Interval> window) {
        long ticks = 0;
        long eu = 0;
        long maxed = 0;
        double peak = 0;
        for (Interval interval : window) {
            ticks += interval.ticks;
            eu += interval.eu;
            maxed += interval.maxed;
            peak = Math.max(peak, (double) interval.eu / interval.ticks);
        }
        if (ticks == 0) {
            return new View(tunnel, nowMillis, null, null, null);
        }
        return new View(tunnel, nowMillis, (double) eu / ticks, peak, (double) maxed / ticks);
    }

    /** At the power sample interval: one history point per tunnel seen since the last one. */
    static void recordSample(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        long fineStart = Math.floorDiv(nowMillis, fineBucketMillis()) * fineBucketMillis();
        for (Map.Entry<String, Tracker> entry : trackers.entrySet()) {
            Tracker tracker = entry.getValue();
            Accumulator fine = tracker.fine;
            if (db != null && fine.ticks > 0) {
                write(db, HistoryTable.POWER_FINE, entry.getKey(), fineStart, fine);
            }
            fine.reset(fineStart);
            Accumulator hourly = tracker.hourly;
            if (db != null && hourly.ticks > 0) {
                // Rewritten every sample, so the hour's row always holds the hour so far.
                write(db, HistoryTable.POWER_HOURLY, entry.getKey(), hourly.bucketStart, hourly);
            }
        }
    }

    private static void write(HistoryDb db, HistoryTable table, String id, long bucketStart, Accumulator acc) {
        db.putGauge(table, id, EU_T, bucketStart, Math.round((double) acc.eu / acc.ticks));
        db.putGauge(table, id, PEAK_EU_T, bucketStart, Math.round(acc.peakEuPerTick));
        db.putGauge(table, id, MAXED_PERMILLE, bucketStart, Math.round(1000.0 * acc.maxed / acc.ticks));
    }

    // --- Reading (HTTP threads) ---

    public static Collection<View> latest() {
        return views.values();
    }

    public static View latest(String tunnelId) {
        return tunnelId == null ? null : views.get(tunnelId);
    }

    /** Wire shape for {@code /api/gt/tunnels/{tunnelId}/history}. -1 = no sample in that window. */
    public static final class Series {

        public String tunnel;
        public long from;
        public long to;
        public long stepMillis;
        public String resolution;
        public long[] euPerTick;
        public long[] peakEuPerTick;
        /** Per-mille of the bucket's ticks the line was maxed out. */
        public long[] maxedPermille;
    }

    /** Same tier choice and downsampling as {@link GTPowerHistoryStore#read}. */
    public static Series read(HistoryDb db, String tunnelId, long fromMillis, long toMillis, int maxPoints) {
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
        series.tunnel = tunnelId;
        series.resolution = useFine ? "fine" : "hourly";
        series.from = fromBucket * tierBucketMillis;
        series.to = toBucket * tierBucketMillis;
        series.stepMillis = step * tierBucketMillis;

        HistoryTable table = useFine ? HistoryTable.POWER_FINE : HistoryTable.POWER_HOURLY;
        series.euPerTick = db.readGauge(table, tunnelId, EU_T, fromBucket, toBucket, step, tierBucketMillis);
        series.peakEuPerTick = db.readGauge(table, tunnelId, PEAK_EU_T, fromBucket, toBucket, step, tierBucketMillis);
        series.maxedPermille = db
            .readGauge(table, tunnelId, MAXED_PERMILLE, fromBucket, toBucket, step, tierBucketMillis);
        return series;
    }

    private static long fineBucketMillis() {
        return TimeUnit.SECONDS.toMillis(Config.INSTANCE.gregtech.powerSampleIntervalSeconds);
    }

    static void clear() {
        trackers.clear();
        views.clear();
    }
}
