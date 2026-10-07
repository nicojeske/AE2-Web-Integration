package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;

/**
 * {@link ItemHistoryStore.RingSeries} mechanics (wraparound, gaps, overwrite) tested directly, plus
 * {@link ItemHistoryStore#sample} / {@link ItemHistoryStore#pruneTo} at the store level. Every store-level
 * test uses its own grid key: {@code gridHistories} is a shared static map for the whole test JVM.
 */
class ItemHistoryStoreTest {

    private static final long NO_SAMPLE = ItemHistoryStore.NO_SAMPLE;

    @BeforeEach
    @AfterEach
    void resetConfigToDefaults() {
        Config.INSTANCE.statistics.sampleIntervalMinutes = 5;
        Config.INSTANCE.statistics.fineRetentionDays = 30;
        Config.INSTANCE.statistics.hourlyRetentionDays = 365;
        Config.INSTANCE.statistics.maxTrackedItemsPerGrid = 24;
    }

    // --- RingSeries mechanics ---

    @Test
    void wraparoundPastCapacityKeepsOnlyTheNewestSamples() {
        ItemHistoryStore.RingSeries ring = new ItemHistoryStore.RingSeries(1000L, 3);
        for (long bucket = 0; bucket <= 4; bucket++) {
            ring.record(bucket, bucket * 10);
        }
        assertEquals(NO_SAMPLE, ring.get(0));
        assertEquals(NO_SAMPLE, ring.get(1));
        assertEquals(20L, ring.get(2));
        assertEquals(30L, ring.get(3));
        assertEquals(40L, ring.get(4));
    }

    @Test
    void anOfflineGapReadsAsNoSampleNotAStaleRepeat() {
        ItemHistoryStore.RingSeries ring = new ItemHistoryStore.RingSeries(1000L, 10);
        ring.record(0, 10L);
        ring.record(5, 50L);
        assertEquals(10L, ring.get(0));
        for (long bucket = 1; bucket <= 4; bucket++) {
            assertEquals(NO_SAMPLE, ring.get(bucket), "gap bucket " + bucket);
        }
        assertEquals(50L, ring.get(5));
    }

    @Test
    void aGapAtLeastCapacityClearsTheWholeBuffer() {
        ItemHistoryStore.RingSeries ring = new ItemHistoryStore.RingSeries(1000L, 3);
        ring.record(0, 10L);
        ring.record(1, 20L);
        ring.record(10, 100L); // gap of 9 >= capacity 3
        assertEquals(NO_SAMPLE, ring.get(0));
        assertEquals(NO_SAMPLE, ring.get(1));
        assertEquals(100L, ring.get(10));
    }

    @Test
    void repeatedWritesToTheSameBucketOverwriteRatherThanAccumulate() {
        // Models the hourly tier's "last sample wins within the hour" behaviour.
        ItemHistoryStore.RingSeries ring = new ItemHistoryStore.RingSeries(1000L, 5);
        ring.record(3, 10L);
        ring.record(3, 20L);
        ring.record(3, 30L);
        assertEquals(30L, ring.get(3));
    }

    @Test
    void anOutOfOrderWriteWithinTheWindowIsAppliedInPlace() {
        ItemHistoryStore.RingSeries ring = new ItemHistoryStore.RingSeries(1000L, 5);
        ring.record(5, 50L);
        ring.record(3, 30L);
        assertEquals(30L, ring.get(3));
        assertEquals(50L, ring.get(5));
    }

    // --- ItemHistoryStore.sample / pruneTo ---

    private static Set<String> oneItem(String itemid) {
        return new LinkedHashSet<>(Arrays.asList(itemid));
    }

    private static long lastPoint(JSON_ItemHistory result, int seriesIndex) {
        long[] points = result.series.get(seriesIndex).points;
        return points[points.length - 1];
    }

    @Test
    void severalStacksSharingAnItemidAreSummed() {
        String gridKey = "950101";
        long now = 10_000_000L;
        ItemHistoryStore.sample(
            gridKey,
            oneItem("minecraft:iron_ingot"),
            TrackingTestFakes.stackList(
                TrackingTestFakes.stack("minecraft:iron_ingot", 100L),
                TrackingTestFakes.stack("minecraft:iron_ingot", 50L)),
            now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList("minecraft:iron_ingot"), now, now, 1);
        assertEquals(150L, lastPoint(result, 0));
    }

    @Test
    void aTrackedItemAbsentFromStorageRecordsZeroNotAGap() {
        String gridKey = "950102";
        long now = 20_000_000L;
        ItemHistoryStore.sample(gridKey, oneItem("minecraft:diamond"), TrackingTestFakes.stackList(), now);

        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList("minecraft:diamond"), now, now, 1);
        assertEquals(0L, lastPoint(result, 0));
    }

    @Test
    void sampleReturnsTheDisplayNameObservedForEachTrackedItemInStorage() {
        String gridKey = "950150";
        long now = 15_000_000L;
        Map<String, String> observed = ItemHistoryStore.sample(
            gridKey,
            oneItem("minecraft:iron_ingot"),
            TrackingTestFakes.stackList(TrackingTestFakes.stack("minecraft:iron_ingot", 5L, "Iron Ingot")),
            now);
        assertEquals("Iron Ingot", observed.get("minecraft:iron_ingot"));
    }

    @Test
    void sampleOmitsATrackedItemThatIsAbsentFromStorageFromTheReturnedNames() {
        String gridKey = "950151";
        long now = 16_000_000L;
        Map<String, String> observed = ItemHistoryStore
            .sample(gridKey, oneItem("minecraft:diamond"), TrackingTestFakes.stackList(), now);
        assertTrue(observed.isEmpty());
    }

    @Test
    void sampleNeverReturnsANameForAnUntrackedItemEvenIfPresentInStorage() {
        String gridKey = "950152";
        long now = 17_000_000L;
        Map<String, String> observed = ItemHistoryStore.sample(
            gridKey,
            oneItem("minecraft:iron_ingot"),
            TrackingTestFakes.stackList(TrackingTestFakes.stack("minecraft:gold_ingot", 9L, "Gold Ingot")),
            now);
        assertFalse(observed.containsKey("minecraft:gold_ingot"));
    }

    @Test
    void anUntrackedItemInStorageIsNotRecorded() {
        String gridKey = "950103";
        long now = 30_000_000L;
        ItemHistoryStore.sample(
            gridKey,
            oneItem("minecraft:iron_ingot"),
            TrackingTestFakes.stackList(
                TrackingTestFakes.stack("minecraft:iron_ingot", 5L),
                TrackingTestFakes.stack("minecraft:gold_ingot", 999L)),
            now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList("minecraft:gold_ingot"), now, now, 1);
        assertEquals(NO_SAMPLE, lastPoint(result, 0));
    }

    @Test
    void samplingWithNoTrackedItemsIsANoOp() {
        String gridKey = "950104";
        long now = 40_000_000L;
        ItemHistoryStore.sample(gridKey, Collections.emptySet(), TrackingTestFakes.stackList(), now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList("minecraft:iron_ingot"), now, now, 1);
        assertEquals(NO_SAMPLE, lastPoint(result, 0));
    }

    @Test
    void pruneToDropsSeriesForItemsNoLongerTracked() {
        String gridKey = "950105";
        long now = 50_000_000L;
        Set<String> tracked = new LinkedHashSet<>(Arrays.asList("minecraft:iron_ingot", "minecraft:gold_ingot"));
        ItemHistoryStore.sample(
            gridKey,
            tracked,
            TrackingTestFakes.stackList(
                TrackingTestFakes.stack("minecraft:iron_ingot", 5L),
                TrackingTestFakes.stack("minecraft:gold_ingot", 9L)),
            now);

        ItemHistoryStore.pruneTo(gridKey, oneItem("minecraft:iron_ingot"));

        List<String> both = Arrays.asList("minecraft:iron_ingot", "minecraft:gold_ingot");
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, both, now, now, 1);
        assertEquals(5L, lastPoint(result, 0));
        assertEquals(NO_SAMPLE, lastPoint(result, 1));
    }

    @Test
    void theHourlyTierKeepsOnlyTheLastSampleWithinEachHourNotAnAverage() {
        String gridKey = "950106";
        Set<String> tracked = oneItem("minecraft:iron_ingot");
        long hourStart = 100 * TimeUnit.HOURS.toMillis(1);
        ItemHistoryStore.sample(
            gridKey,
            tracked,
            TrackingTestFakes.stackList(TrackingTestFakes.stack("minecraft:iron_ingot", 10L)),
            hourStart + 1_000L);
        ItemHistoryStore.sample(
            gridKey,
            tracked,
            TrackingTestFakes.stackList(TrackingTestFakes.stack("minecraft:iron_ingot", 20L)),
            hourStart + 2_000L);
        ItemHistoryStore.sample(
            gridKey,
            tracked,
            TrackingTestFakes.stackList(TrackingTestFakes.stack("minecraft:iron_ingot", 30L)),
            hourStart + 3_000L);

        // A span far beyond the fine tier's retention forces the hourly tier to answer.
        long farFuture = hourStart + 3_000L + TimeUnit.DAYS.toMillis(400);
        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList("minecraft:iron_ingot"), hourStart, farFuture, 1);
        assertEquals("hourly", result.resolution);
        assertEquals(30L, lastPoint(result, 0));
    }
}
