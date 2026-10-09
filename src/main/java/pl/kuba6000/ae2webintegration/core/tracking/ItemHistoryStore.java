package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;

/**
 * Per-grid, per-item stored-count history of every item in a grid, in two tiers (fine resolution at the
 * configured sample interval, an hourly rollup covering a much longer window) kept in the history database.
 * Without one there is no item history: {@link #sample} does nothing and {@code GetItemHistory} answers
 * {@code HISTORY_DISABLED}.
 * <p>
 * Only ever touches stored data through {@link #sample} (called on the server thread with a live
 * {@link IStackList}) and {@link #readSeries} (called from the {@code GetItemHistory} async request on an
 * HTTP worker thread) - it never reaches into AE2 itself.
 */
public final class ItemHistoryStore {

    /** Stored counts are always >= 0, so this is unambiguous and keeps the wire form plain longs. */
    public static final long NO_SAMPLE = HistoryDb.NO_SAMPLE;

    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);

    private ItemHistoryStore() {}

    /**
     * Sums stored amounts per {@code itemid} over one grid's storage list and records one sample for every
     * item in it. An item recorded before that is no longer stored records a real {@code 0}, so its history
     * never carries a stale count forward; an item that is only craftable (amount 0) and was never stored
     * creates no series at all. Values are written change-only, so an unchanged item costs nothing.
     */
    public static void sample(String gridKey, IStackList storage, long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return;
        }
        Map<String, Long> stored = new HashMap<>();
        Map<String, String> names = new HashMap<>();
        for (IAEGenericStack stack : storage.web$stacks()) {
            long amount = stack.web$amount();
            if (amount <= 0) {
                continue;
            }
            IAEKey key = stack.web$what();
            String itemid = key.web$getItemID();
            stored.merge(itemid, amount, Long::sum);
            names.putIfAbsent(itemid, key.web$getDisplayName());
        }
        for (String known : db.knownKeys(HistoryTable.ITEM_FINE, gridKey)) {
            stored.putIfAbsent(known, 0L);
        }

        long fineBucketMillis = fineBucketMillis();
        long fineStart = Math.floorDiv(nowMillis, fineBucketMillis) * fineBucketMillis;
        long hourlyStart = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS) * HOURLY_BUCKET_MILLIS;
        for (Map.Entry<String, Long> entry : stored.entrySet()) {
            db.putGauge(HistoryTable.ITEM_FINE, gridKey, entry.getKey(), fineStart, entry.getValue());
            db.putGauge(HistoryTable.ITEM_HOURLY, gridKey, entry.getKey(), hourlyStart, entry.getValue());
        }
        for (Map.Entry<String, String> entry : names.entrySet()) {
            db.putName(HistoryTable.ITEM_FINE, gridKey, entry.getKey(), entry.getValue());
        }
        db.markSampled(HistoryTable.ITEM_FINE, gridKey, fineStart, fineBucketMillis);
        db.markSampled(HistoryTable.ITEM_HOURLY, gridKey, hourlyStart, HOURLY_BUCKET_MILLIS);
    }

    /**
     * Builds the {@code GetItemHistory} response: one tier is picked for the whole request by comparing the
     * requested span against the fine tier's retention, then downsampled if needed by taking the newest
     * non-gap value in each output window - never averaged, so no floating point and no NaN-serialization
     * hazard (see {@code GSONUtils}'s known-unfixed leniency gap).
     */
    public static JSON_ItemHistory readSeries(HistoryDb db, String gridKey, List<String> itemids, long fromMillis,
        long toMillis, int maxPoints) {
        JSON_ItemHistory result = new JSON_ItemHistory();
        long fromClamped = Math.min(fromMillis, toMillis);
        long toClamped = Math.max(fromMillis, toMillis);
        long span = toClamped - fromClamped;
        boolean useFine = span <= TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.fineRetentionDays);
        long tierBucketMillis = useFine ? fineBucketMillis() : HOURLY_BUCKET_MILLIS;
        result.resolution = useFine ? "fine" : "hourly";

        long fromBucket = Math.floorDiv(fromClamped, tierBucketMillis);
        long toBucket = Math.max(fromBucket, Math.floorDiv(toClamped, tierBucketMillis));
        long totalBuckets = toBucket - fromBucket + 1;
        int cappedMaxPoints = Math.max(1, maxPoints);
        long stepBuckets = totalBuckets <= cappedMaxPoints ? 1 : (totalBuckets + cappedMaxPoints - 1) / cappedMaxPoints;

        result.from = fromBucket * tierBucketMillis;
        result.to = toBucket * tierBucketMillis;
        result.stepMillis = stepBuckets * tierBucketMillis;

        HistoryTable table = useFine ? HistoryTable.ITEM_FINE : HistoryTable.ITEM_HOURLY;
        for (String itemid : itemids) {
            long[] values = db.readGauge(table, gridKey, itemid, fromBucket, toBucket, stepBuckets, tierBucketMillis);
            result.series.add(new JSON_ItemHistory.JSON_ItemSeries(itemid, values));
        }
        result.names.putAll(db.readNames(HistoryTable.ITEM_FINE, gridKey, itemids));
        return result;
    }

    /** Drops samples past the configured retention; rate-limited by {@link HistoryDb#prune}. */
    public static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return;
        }
        db.prune(
            HistoryTable.ITEM_FINE,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.fineRetentionDays),
            nowMillis);
        db.prune(
            HistoryTable.ITEM_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.hourlyRetentionDays),
            nowMillis);
    }

    private static long fineBucketMillis() {
        return TimeUnit.MINUTES.toMillis(Config.INSTANCE.statistics.sampleIntervalMinutes);
    }
}
