package pl.kuba6000.ae2webintegration.core.gt;

import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * Sparse time series of longs keyed by absolute bucket number ({@code epochMillis / bucketMillis}).
 * <p>
 * Sparse rather than a ring like {@code ItemHistoryStore.RingSeries}, because GregTech data is lumpy: a
 * production pair only has buckets for hours the machine actually ran, and a power source only for scans
 * where it was loaded. Thread-safe: writes come from the server thread, reads from HTTP workers.
 */
final class BucketSeries {

    private final TreeMap<Long, Long> buckets = new TreeMap<>();

    synchronized void add(long bucket, long delta) {
        buckets.merge(bucket, delta, BucketSeries::saturatedAdd);
    }

    synchronized void set(long bucket, long value) {
        buckets.put(bucket, value);
    }

    /** Sum over {@code [fromBucket, toBucket]}, both inclusive. */
    synchronized long sum(long fromBucket, long toBucket) {
        long total = 0;
        for (long value : buckets.subMap(fromBucket, true, toBucket, true)
            .values()) {
            total = saturatedAdd(total, value);
        }
        return total;
    }

    /** Newest value in {@code [fromBucket, toBucket]}, or {@code missing} if there is none. */
    synchronized long newest(long fromBucket, long toBucket, long missing) {
        if (fromBucket > toBucket) {
            return missing;
        }
        Map.Entry<Long, Long> entry = buckets.floorEntry(toBucket);
        return entry == null || entry.getKey() < fromBucket ? missing : entry.getValue();
    }

    synchronized boolean isEmpty() {
        return buckets.isEmpty();
    }

    /** Drops every bucket older than {@code minBucket}; returns whether anything was dropped. */
    synchronized boolean prune(long minBucket) {
        NavigableMap<Long, Long> old = buckets.headMap(minBucket, false);
        if (old.isEmpty()) {
            return false;
        }
        old.clear();
        return true;
    }

    synchronized TreeMap<Long, Long> snapshot() {
        return new TreeMap<>(buckets);
    }

    static BucketSeries fromSnapshot(Map<Long, Long> snapshot) {
        BucketSeries series = new BucketSeries();
        if (snapshot != null) {
            for (Map.Entry<Long, Long> entry : snapshot.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    series.buckets.put(entry.getKey(), entry.getValue());
                }
            }
        }
        return series;
    }

    static long saturatedAdd(long a, long b) {
        long result = a + b;
        // Overflow iff both operands have the same sign and the result's sign differs.
        if (((a ^ result) & (b ^ result)) < 0) {
            return a < 0 ? Long.MIN_VALUE : Long.MAX_VALUE;
        }
        return result;
    }
}
