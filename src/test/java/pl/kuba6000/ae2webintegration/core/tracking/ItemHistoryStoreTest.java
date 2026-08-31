package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;

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
        ConfigBootstrap.statisticsSampleIntervalMinutesValue = () -> 5;
        ConfigBootstrap.statisticsFineRetentionDaysValue = () -> 30;
        ConfigBootstrap.statisticsHourlyRetentionDaysValue = () -> 365;
        ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue = () -> 24;
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
        long gridKey = 950_101L;
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
        long gridKey = 950_102L;
        long now = 20_000_000L;
        ItemHistoryStore.sample(gridKey, oneItem("minecraft:diamond"), TrackingTestFakes.stackList(), now);

        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList("minecraft:diamond"), now, now, 1);
        assertEquals(0L, lastPoint(result, 0));
    }

    @Test
    void anUntrackedItemInStorageIsNotRecorded() {
        long gridKey = 950_103L;
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
        long gridKey = 950_104L;
        long now = 40_000_000L;
        ItemHistoryStore.sample(gridKey, Collections.emptySet(), TrackingTestFakes.stackList(), now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList("minecraft:iron_ingot"), now, now, 1);
        assertEquals(NO_SAMPLE, lastPoint(result, 0));
    }

    @Test
    void pruneToDropsSeriesForItemsNoLongerTracked() {
        long gridKey = 950_105L;
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
        long gridKey = 950_106L;
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
