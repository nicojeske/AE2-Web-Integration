package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;

/**
 * {@code itemhistory.json} round trip, failure handling, and the load-time capacity/bucket-size
 * reconciliation described on {@code RingSeries.fromSnapshot}. Follows {@code CoreDataTest}'s pattern:
 * {@code @TempDir} + {@link Config#init}, hand-authored JSON for the failure/mismatch cases.
 */
class ItemHistoryPersistenceTest {

    private static final String ITEM = "minecraft:iron_ingot";
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        ConfigBootstrap.statisticsSampleIntervalMinutesValue = () -> 60; // 1h fine buckets
        ConfigBootstrap.statisticsFineRetentionDaysValue = () -> 1; // 24 fine buckets
        ConfigBootstrap.statisticsHourlyRetentionDaysValue = () -> 10; // 240 hourly buckets
        ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue = () -> 24;
    }

    @AfterEach
    void resetConfigToDefaults() {
        ConfigBootstrap.statisticsSampleIntervalMinutesValue = () -> 5;
        ConfigBootstrap.statisticsFineRetentionDaysValue = () -> 30;
        ConfigBootstrap.statisticsHourlyRetentionDaysValue = () -> 365;
        ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue = () -> 24;
    }

    @Test
    void roundTripThroughSaveNowThenLoadDataPreservesSampledValues() {
        long gridKey = 970_001L;
        long now = 5 * HOUR;
        ItemHistoryStore
            .sample(gridKey, oneItem(), TrackingTestFakes.stackList(TrackingTestFakes.stack(ITEM, 42L)), now);

        ItemHistoryStore.saveNow();
        // loadData() reassigns the whole in-memory map from disk, so this only passes if the file it just
        // wrote actually round-trips the sampled value, not because memory was left untouched.
        ItemHistoryStore.loadData();

        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), now, now, 1);
        assertEquals(42L, lastPoint(result));
    }

    @Test
    void aMalformedFileIsNotOverwrittenAndMemoryIsKept() throws Exception {
        long gridKey = 970_002L;
        long now = 6 * HOUR;
        ItemHistoryStore
            .sample(gridKey, oneItem(), TrackingTestFakes.stackList(TrackingTestFakes.stack(ITEM, 7L)), now);
        ItemHistoryStore.saveNow();

        String garbage = "{ this is not json";
        writeHistoryFile(garbage);

        ItemHistoryStore.loadData();

        assertEquals(garbage, readHistoryFile(), "a failed read must not persist over the file it failed on");
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), now, now, 1);
        assertEquals(7L, lastPoint(result), "a failed load must not wipe what was already in memory");
    }

    @Test
    void aRetentionDecreaseOnLoadKeepsOnlyTheNewestSamples() throws Exception {
        long gridKey = 970_003L;
        long oldCapacity = 48;
        long newestBucket = 47; // no wraparound below, so values[i] lands at bucket i directly
        StringBuilder values = new StringBuilder();
        for (long bucket = 0; bucket < oldCapacity; bucket++) {
            if (bucket > 0) values.append(',');
            values.append(bucket);
        }
        // bucketMillis matches the currently configured fine tier (1h), but this snapshot's capacity (48)
        // is larger than what statisticsFineRetentionDaysValue=1 now implies (24) - a resize, not a reset.
        writeHistoryFile(
            "{\"schemaVersion\":1,\"grids\":{\"" + gridKey
                + "\":{\""
                + ITEM
                + "\":{\"fine\":{\"bucketMillis\":"
                + HOUR
                + ",\"newestBucket\":"
                + newestBucket
                + ",\"values\":["
                + values
                + "]}}}}}");

        ItemHistoryStore.loadData();

        // Only the newest 24 of the 48 persisted buckets (24..47) survive the resize to capacity 24.
        JSON_ItemHistory kept = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), 24 * HOUR, 24 * HOUR, 1);
        assertEquals(24L, lastPoint(kept));
        JSON_ItemHistory dropped = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), 23 * HOUR, 23 * HOUR, 1);
        assertEquals(ItemHistoryStore.NO_SAMPLE, lastPoint(dropped));
    }

    @Test
    void aSampleIntervalChangeOnLoadDiscardsFineDataButKeepsHourly() throws Exception {
        long gridKey = 970_004L;
        long mismatchedBucketMillis = HOUR / 2; // persisted at 30 min, now configured for 60 min
        // Fine: bucket size no longer matches - must be discarded rather than resized.
        // Hourly: HOURLY_BUCKET_MILLIS is fixed, so this snapshot's bucket size always matches - a plain
        // resize, unaffected by the fine-tier interval change.
        writeHistoryFile(
            "{\"schemaVersion\":1,\"grids\":{\"" + gridKey
                + "\":{\""
                + ITEM
                + "\":{"
                + "\"fine\":{\"bucketMillis\":"
                + mismatchedBucketMillis
                + ",\"newestBucket\":5,\"values\":[999]},"
                + "\"hourly\":{\"bucketMillis\":"
                + HOUR
                + ",\"newestBucket\":2,\"values\":[10,20,30]}"
                + "}}}}");

        ItemHistoryStore.loadData();

        // Span within the fine tier's retention (24h) - the mismatched snapshot was discarded, so every
        // bucket is a gap.
        JSON_ItemHistory fine = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), 0L, 3 * HOUR, 4);
        assertEquals("fine", fine.resolution);
        for (long point : fine.series.get(0).points) {
            assertEquals(ItemHistoryStore.NO_SAMPLE, point);
        }

        // A span beyond the fine tier's retention forces the hourly tier, which survived the reload.
        JSON_ItemHistory hourly = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList(ITEM), 0L, TimeUnit.DAYS.toMillis(2), 49);
        assertEquals("hourly", hourly.resolution);
        assertEquals(30L, hourly.series.get(0).points[2]);
    }

    private static java.util.Set<String> oneItem() {
        return new java.util.LinkedHashSet<>(Arrays.asList(ITEM));
    }

    private static long lastPoint(JSON_ItemHistory result) {
        long[] points = result.series.get(0).points;
        return points[points.length - 1];
    }

    private File historyFile() {
        return new File(configRoot, "ae2webintegration/itemhistory.json");
    }

    private void writeHistoryFile(String content) throws Exception {
        File file = historyFile();
        file.getParentFile()
            .mkdirs();
        Files.write(file.toPath(), content.getBytes(StandardCharsets.UTF_8));
    }

    private String readHistoryFile() throws Exception {
        return new String(Files.readAllBytes(historyFile().toPath()), StandardCharsets.UTF_8);
    }
}
