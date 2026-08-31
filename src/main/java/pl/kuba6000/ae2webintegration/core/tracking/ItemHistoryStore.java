package pl.kuba6000.ae2webintegration.core.tracking;

import java.io.File;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.google.common.io.Files;
import com.google.gson.Gson;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;
import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

/**
 * Per-grid, per-item stored-count history: a two-tier ring buffer (fine resolution at the configured
 * sample interval, an hourly rollup covering a much longer window) sampled once per grid per tick from
 * {@code CoreEngine.onServerTick()} and persisted to its own file, separate from {@code griddata.json}.
 * <p>
 * Only ever touches stored data through {@link #sample} (called on the server thread with a live
 * {@link IStackList}) and {@link #readSeries} (called from the {@code /itemhistory} async request on an
 * HTTP worker thread) - it never reaches into AE2 itself.
 */
public final class ItemHistoryStore {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    /** Stored counts are always >= 0, so this is unambiguous and keeps the wire/disk form plain longs. */
    public static final long NO_SAMPLE = -1L;

    private static final long HOURLY_BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);
    private static final int SCHEMA_VERSION = 1;

    private ItemHistoryStore() {}

    // --- Runtime state ---

    private static final class ItemSeries {

        final RingSeries fine;
        final RingSeries hourly;

        ItemSeries(RingSeries fine, RingSeries hourly) {
            this.fine = fine;
            this.hourly = hourly;
        }
    }

    private static final class GridHistory {

        final ConcurrentHashMap<String, ItemSeries> items = new ConcurrentHashMap<>();
    }

    private static volatile ConcurrentHashMap<Long, GridHistory> gridHistories = new ConcurrentHashMap<>();

    private static final AtomicBoolean dirty = new AtomicBoolean(false);

    // --- Sampling ---

    /**
     * Sums stored amounts per {@code itemid} over one grid's storage list and records one sample for
     * every tracked item, including a real {@code 0} for a tracked item currently absent from the
     * network (never a gap - the item is still tracked, it is simply empty right now).
     */
    public static void sample(long gridKey, Set<String> tracked, IStackList storage, long nowMillis) {
        if (tracked.isEmpty()) {
            return;
        }
        Map<String, Long> stored = new HashMap<>();
        for (String itemid : tracked) {
            stored.put(itemid, 0L);
        }
        for (IAEGenericStack stack : storage.web$stacks()) {
            String itemid = stack.web$what()
                .web$getItemID();
            if (!stored.containsKey(itemid)) {
                continue;
            }
            stored.merge(itemid, stack.web$amount(), Long::sum);
        }

        long fineBucketMillis = fineBucketMillis();
        int fineCapacity = fineCapacity();
        int hourlyCapacity = hourlyCapacity();
        long fineBucket = Math.floorDiv(nowMillis, fineBucketMillis);
        long hourlyBucket = Math.floorDiv(nowMillis, HOURLY_BUCKET_MILLIS);

        GridHistory history = gridHistories.computeIfAbsent(gridKey, k -> new GridHistory());
        for (String itemid : tracked) {
            long value = stored.getOrDefault(itemid, 0L);
            ItemSeries series = history.items.computeIfAbsent(
                itemid,
                k -> new ItemSeries(
                    new RingSeries(fineBucketMillis, fineCapacity),
                    new RingSeries(HOURLY_BUCKET_MILLIS, hourlyCapacity)));
            series.fine.record(fineBucket, value);
            series.hourly.record(hourlyBucket, value);
        }
        dirty.set(true);
    }

    /** Drops any series for items that are no longer tracked, e.g. after {@code TrackedItems} removes one. */
    public static void pruneTo(long gridKey, Set<String> tracked) {
        GridHistory history = gridHistories.get(gridKey);
        if (history == null) {
            return;
        }
        if (history.items.keySet()
            .retainAll(tracked)) {
            dirty.set(true);
        }
    }

    // --- Reading ---

    /**
     * Builds the {@code /itemhistory} response: one tier is picked for the whole request by comparing the
     * requested span against the fine tier's retention, then downsampled if needed by taking the newest
     * non-gap value in each output window - never averaged, so no floating point and no NaN-serialization
     * hazard (see {@code GSONUtils}'s known-unfixed leniency gap).
     */
    public static JSON_ItemHistory readSeries(long gridKey, List<String> itemids, long fromMillis, long toMillis,
        int maxPoints) {
        JSON_ItemHistory result = new JSON_ItemHistory();
        long fromClamped = Math.min(fromMillis, toMillis);
        long toClamped = Math.max(fromMillis, toMillis);
        long span = toClamped - fromClamped;
        long fineSpanMillis = fineBucketMillis() * fineCapacity();
        boolean useFine = span <= fineSpanMillis;
        long tierBucketMillis = useFine ? fineBucketMillis() : HOURLY_BUCKET_MILLIS;
        result.resolution = useFine ? "fine" : "hourly";
        result.limit = Config.STATISTICS_MAX_TRACKED_ITEMS_PER_GRID();

        long fromBucket = Math.floorDiv(fromClamped, tierBucketMillis);
        long toBucket = Math.max(fromBucket, Math.floorDiv(toClamped, tierBucketMillis));
        long totalBuckets = toBucket - fromBucket + 1;
        int cappedMaxPoints = Math.max(1, maxPoints);
        long stepBuckets = totalBuckets <= cappedMaxPoints ? 1 : (totalBuckets + cappedMaxPoints - 1) / cappedMaxPoints;

        result.from = fromBucket * tierBucketMillis;
        result.to = toBucket * tierBucketMillis;
        result.stepMillis = stepBuckets * tierBucketMillis;

        GridHistory history = gridHistories.get(gridKey);
        for (String itemid : itemids) {
            ItemSeries series = history == null ? null : history.items.get(itemid);
            RingSeries ring = series == null ? null : (useFine ? series.fine : series.hourly);
            ArrayList<Long> points = new ArrayList<>();
            for (long windowStart = fromBucket; windowStart <= toBucket; windowStart += stepBuckets) {
                long windowEnd = Math.min(windowStart + stepBuckets - 1, toBucket);
                long value = NO_SAMPLE;
                if (ring != null) {
                    for (long bucket = windowEnd; bucket >= windowStart; bucket--) {
                        long candidate = ring.get(bucket);
                        if (candidate != NO_SAMPLE) {
                            value = candidate;
                            break;
                        }
                    }
                }
                points.add(value);
            }
            long[] values = new long[points.size()];
            for (int i = 0; i < values.length; i++) {
                values[i] = points.get(i);
            }
            result.series.add(new JSON_ItemHistory.JSON_ItemSeries(itemid, values));
        }
        return result;
    }

    private static long fineBucketMillis() {
        return TimeUnit.MINUTES.toMillis(Config.STATISTICS_SAMPLE_INTERVAL_MINUTES());
    }

    private static int fineCapacity() {
        long totalMillis = TimeUnit.DAYS.toMillis(Config.STATISTICS_FINE_RETENTION_DAYS());
        return (int) Math.max(1, totalMillis / fineBucketMillis());
    }

    private static int hourlyCapacity() {
        return Math.max(1, Config.STATISTICS_HOURLY_RETENTION_DAYS() * 24);
    }

    // --- Ring buffer ---

    /**
     * One fixed-resolution ring of longs, indexed by an absolute bucket number ({@code epochMillis /
     * bucketMillis}). Advancing past a gap clears the skipped slots so a server that was offline reads
     * back as {@link #NO_SAMPLE} there, never as a stale repeat of the last known value.
     */
    static final class RingSeries {

        final long bucketMillis;
        private long[] values;
        private long newestBucket = Long.MIN_VALUE;

        RingSeries(long bucketMillis, int capacity) {
            this.bucketMillis = bucketMillis;
            this.values = new long[Math.max(1, capacity)];
            Arrays.fill(values, NO_SAMPLE);
        }

        private RingSeries(long bucketMillis, long[] values, long newestBucket) {
            this.bucketMillis = bucketMillis;
            this.values = values;
            this.newestBucket = newestBucket;
        }

        synchronized void record(long bucket, long value) {
            int capacity = values.length;
            if (newestBucket == Long.MIN_VALUE) {
                values[index(bucket, capacity)] = value;
                newestBucket = bucket;
                return;
            }
            if (bucket <= newestBucket) {
                // Out-of-order or same-bucket write (e.g. two samples landing in the same hourly bucket) -
                // overwrite in place only if it is still within the retained window.
                if (newestBucket - bucket < capacity) {
                    values[index(bucket, capacity)] = value;
                }
                return;
            }
            long gap = bucket - newestBucket;
            if (gap >= capacity) {
                Arrays.fill(values, NO_SAMPLE);
            } else {
                for (long skipped = newestBucket + 1; skipped < bucket; skipped++) {
                    values[index(skipped, capacity)] = NO_SAMPLE;
                }
            }
            values[index(bucket, capacity)] = value;
            newestBucket = bucket;
        }

        synchronized long get(long bucket) {
            if (newestBucket == Long.MIN_VALUE || bucket > newestBucket) {
                return NO_SAMPLE;
            }
            if (newestBucket - bucket >= values.length) {
                return NO_SAMPLE;
            }
            return values[index(bucket, values.length)];
        }

        synchronized RingSnapshot snapshot() {
            RingSnapshot snapshot = new RingSnapshot();
            snapshot.bucketMillis = bucketMillis;
            snapshot.newestBucket = newestBucket;
            snapshot.values = values.clone();
            return snapshot;
        }

        /**
         * Rebuilds from a persisted snapshot against the currently configured bucket size and capacity. A
         * bucket-size mismatch (the sample interval changed since the last save) discards the data rather
         * than resizing - the bucket numbering itself would no longer line up. A capacity-only mismatch
         * (a retention setting changed) resizes, keeping the newest overlapping samples.
         */
        static RingSeries fromSnapshot(RingSnapshot snapshot, long desiredBucketMillis, int desiredCapacity) {
            if (snapshot == null || snapshot.values == null
                || snapshot.values.length == 0
                || snapshot.bucketMillis != desiredBucketMillis) {
                return new RingSeries(desiredBucketMillis, desiredCapacity);
            }
            RingSeries loaded = new RingSeries(snapshot.bucketMillis, snapshot.values, snapshot.newestBucket);
            if (snapshot.values.length == desiredCapacity) {
                return loaded;
            }
            return loaded.resized(desiredCapacity);
        }

        private synchronized RingSeries resized(int newCapacity) {
            RingSeries resized = new RingSeries(bucketMillis, newCapacity);
            if (newestBucket == Long.MIN_VALUE) {
                return resized;
            }
            int keep = Math.min(values.length, newCapacity);
            for (int i = 0; i < keep; i++) {
                long bucket = newestBucket - i;
                long value = get(bucket);
                if (value != NO_SAMPLE) {
                    resized.values[index(bucket, newCapacity)] = value;
                }
            }
            resized.newestBucket = newestBucket;
            return resized;
        }

        private static int index(long bucket, int capacity) {
            int modulo = (int) (bucket % capacity);
            return modulo < 0 ? modulo + capacity : modulo;
        }
    }

    // --- Persistence ---

    private static File dataFile() {
        return Config.getConfigFile("itemhistory.json");
    }

    private static final class RingSnapshot {

        long bucketMillis;
        long newestBucket;
        long[] values;
    }

    private static final class PersistedItemSeries {

        RingSnapshot fine;
        RingSnapshot hourly;
    }

    private static final class PersistedFile {

        int schemaVersion = SCHEMA_VERSION;
        Map<Long, Map<String, PersistedItemSeries>> grids = new LinkedHashMap<>();
    }

    private static PersistedFile buildSnapshot() {
        PersistedFile file = new PersistedFile();
        for (Map.Entry<Long, GridHistory> gridEntry : gridHistories.entrySet()) {
            Map<String, PersistedItemSeries> items = new LinkedHashMap<>();
            for (Map.Entry<String, ItemSeries> itemEntry : gridEntry.getValue().items.entrySet()) {
                ItemSeries series = itemEntry.getValue();
                PersistedItemSeries persisted = new PersistedItemSeries();
                persisted.fine = series.fine.snapshot();
                persisted.hourly = series.hourly.snapshot();
                items.put(itemEntry.getKey(), persisted);
            }
            if (!items.isEmpty()) {
                file.grids.put(gridEntry.getKey(), items);
            }
        }
        return file;
    }

    /** Synchronous write - only called from {@code onServerStopping}, where blocking the shutdown is fine. */
    public static void saveNow() {
        if (Config.getConfigDirectory() == null) {
            // Startup failed before Config.init() ran, or a test never called it - a relative path under
            // the process's working directory would be the wrong place to write, so skip entirely rather
            // than guess. onServerStopped()'s own javadoc already covers a startup that failed partway.
            return;
        }
        try {
            GSONUtils.writeAtomically(dataFile(), buildSnapshot());
        } catch (Exception e) {
            LOG.error("Failed to save item history", e);
        }
        dirty.set(false);
        pendingWrite.set(null);
    }

    /** Called periodically from {@code CoreEngine}; only schedules a background write if data changed. */
    public static void flushIfDirty() {
        if (Config.getConfigDirectory() == null) {
            return;
        }
        if (dirty.compareAndSet(true, false)) {
            submitWrite(buildSnapshot());
        }
    }

    // At most one write in flight; a newer snapshot supersedes whatever is still queued, so this never
    // backs up behind a slow disk - it just writes the latest state whenever the previous write finishes.
    private static final AtomicReference<PersistedFile> pendingWrite = new AtomicReference<>();
    private static final AtomicBoolean writeInFlight = new AtomicBoolean(false);
    private static volatile ExecutorService writer;

    private static ExecutorService writer() {
        ExecutorService current = writer;
        if (current == null) {
            synchronized (ItemHistoryStore.class) {
                current = writer;
                if (current == null) {
                    current = Executors.newSingleThreadExecutor(r -> {
                        Thread thread = new Thread(r, "ae2webintegration-item-history-writer");
                        thread.setDaemon(true);
                        return thread;
                    });
                    writer = current;
                }
            }
        }
        return current;
    }

    private static void submitWrite(PersistedFile snapshot) {
        pendingWrite.set(snapshot);
        if (writeInFlight.compareAndSet(false, true)) {
            writer().submit(ItemHistoryStore::drainWrites);
        }
    }

    private static void drainWrites() {
        PersistedFile toWrite;
        while ((toWrite = pendingWrite.getAndSet(null)) != null) {
            try {
                GSONUtils.writeAtomically(dataFile(), toWrite);
            } catch (Exception e) {
                LOG.error("Failed to save item history", e);
            }
        }
        writeInFlight.set(false);
        // A write could have been queued between the loop's last check and the flag reset above.
        if (pendingWrite.get() != null && writeInFlight.compareAndSet(false, true)) {
            writer().submit(ItemHistoryStore::drainWrites);
        }
    }

    public static void loadData() {
        if (Config.getConfigDirectory() == null) {
            LOG.warn("Item history: config directory not initialized, starting with empty history.");
            return;
        }
        File file = dataFile();
        if (!file.exists()) {
            LOG.info("Item history file not found, starting with empty history.");
            return;
        }
        Gson gson = GSONUtils.GSON_BUILDER.create();
        try (Reader reader = Files.newReader(file, StandardCharsets.UTF_8)) {
            PersistedFile loaded = gson.fromJson(reader, PersistedFile.class);
            if (loaded == null) {
                LOG.error("Item history file is empty or malformed, starting with empty history.");
                return;
            }
            if (loaded.schemaVersion > SCHEMA_VERSION) {
                LOG.warn(
                    "Item history file was written by a newer version (schema " + loaded.schemaVersion
                        + "), reading it as schema "
                        + SCHEMA_VERSION);
            }
            long fineBucketMillis = fineBucketMillis();
            int fineCapacity = fineCapacity();
            int hourlyCapacity = hourlyCapacity();
            ConcurrentHashMap<Long, GridHistory> rebuilt = new ConcurrentHashMap<>();
            if (loaded.grids != null) {
                for (Map.Entry<Long, Map<String, PersistedItemSeries>> gridEntry : loaded.grids.entrySet()) {
                    GridHistory history = new GridHistory();
                    if (gridEntry.getValue() != null) {
                        for (Map.Entry<String, PersistedItemSeries> itemEntry : gridEntry.getValue()
                            .entrySet()) {
                            PersistedItemSeries persisted = itemEntry.getValue();
                            if (persisted == null) {
                                continue;
                            }
                            RingSeries fine = RingSeries.fromSnapshot(persisted.fine, fineBucketMillis, fineCapacity);
                            RingSeries hourly = RingSeries
                                .fromSnapshot(persisted.hourly, HOURLY_BUCKET_MILLIS, hourlyCapacity);
                            history.items.put(itemEntry.getKey(), new ItemSeries(fine, hourly));
                        }
                    }
                    rebuilt.put(gridEntry.getKey(), history);
                }
            }
            gridHistories = rebuilt;
        } catch (Exception e) {
            // As in GridData/CoreData: a failed read must not overwrite the file it failed on.
            LOG.error("Failed to load item history from file: " + file.getAbsolutePath(), e);
        }
    }

    /**
     * Resets only the sampler's own scheduling bookkeeping (mirrors {@code CoreEngine.resetHistorySampling}).
     * Deliberately does not clear {@link #gridHistories}: unlike {@code AE2JobTracker}'s per-world-session
     * tracking, sampled history is meant to survive a server stop/start within the same JVM, the same way
     * {@code GridData.isTracked} does - it is either still in memory or already on disk via {@link #saveNow}.
     */
    public static void clearRuntimeState() {
        dirty.set(false);
        pendingWrite.set(null);
    }
}
