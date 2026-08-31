package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;

/**
 * {@link ItemHistoryStore#readSeries} at the tier-selection / downsampling / bucket-arithmetic level.
 * Configured with a small 1-hour fine bucket and 1-day fine retention (24 buckets) so a whole retention
 * window is cheap to fill by hand in a test.
 */
class ItemHistoryReadTest {

    private static final String ITEM = "minecraft:iron_ingot";
    private static final long BUCKET_MILLIS = TimeUnit.HOURS.toMillis(1);

    @BeforeEach
    void smallFineTier() {
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

    private static Set<String> oneItem() {
        return new LinkedHashSet<>(Arrays.asList(ITEM));
    }

    @Test
    void spanWithinFineRetentionUsesFineResolution() {
        long gridKey = 960_001L;
        long now = 1_000_000_000L;
        ItemHistoryStore
            .sample(gridKey, oneItem(), TrackingTestFakes.stackList(TrackingTestFakes.stack(ITEM, 1L)), now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList(ITEM), now - TimeUnit.HOURS.toMillis(12), now, 10);
        assertEquals("fine", result.resolution);
    }

    @Test
    void spanBeyondFineRetentionUsesHourlyResolution() {
        long gridKey = 960_002L;
        long now = 1_000_000_000L;
        ItemHistoryStore
            .sample(gridKey, oneItem(), TrackingTestFakes.stackList(TrackingTestFakes.stack(ITEM, 1L)), now);

        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(gridKey, Arrays.asList(ITEM), now - TimeUnit.DAYS.toMillis(2), now, 10);
        assertEquals("hourly", result.resolution);
    }

    @Test
    void downsampleTakesTheNewestNonGapValueInEachWindow() {
        long gridKey = 960_003L;
        Set<String> tracked = oneItem();
        long start = 10 * BUCKET_MILLIS; // bucket-aligned
        for (int i = 0; i < 12; i++) {
            long t = start + i * BUCKET_MILLIS;
            ItemHistoryStore.sample(gridKey, tracked, TrackingTestFakes.stackList(TrackingTestFakes.stack(ITEM, i)), t);
        }
        long from = start;
        long to = start + 11 * BUCKET_MILLIS;

        // 12 raw buckets, 4 requested points -> stepBuckets = ceil(12/4) = 3.
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), from, to, 4);
        assertEquals("fine", result.resolution);
        long[] points = result.series.get(0).points;
        // Each 3-bucket window [0,1,2],[3,4,5],[6,7,8],[9,10,11] reports its newest (last) value, not an
        // average or the earliest - values were written increasing with bucket order, so this also proves
        // "newest", not "earliest" or "average", was picked.
        assertArrayEquals(new long[] { 2, 5, 8, 11 }, points);
    }

    @Test
    void aWindowWithNoSamplesAnywhereStaysAGap() {
        long gridKey = 960_004L; // never sampled at all
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), 0L, 5 * BUCKET_MILLIS, 2);
        for (long point : result.series.get(0).points) {
            assertEquals(ItemHistoryStore.NO_SAMPLE, point);
        }
    }

    @Test
    void resultFromToAndStepMillisMatchBucketArithmetic() {
        long gridKey = 960_005L;
        long fromMillis = 5 * BUCKET_MILLIS + 1234; // deliberately not bucket-aligned
        long toMillis = 9 * BUCKET_MILLIS + 999;

        // totalBuckets = 9-5+1 = 5 <= 100 requested points -> no downsampling, step = 1 bucket.
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), fromMillis, toMillis, 100);
        assertEquals(5 * BUCKET_MILLIS, result.from);
        assertEquals(9 * BUCKET_MILLIS, result.to);
        assertEquals(BUCKET_MILLIS, result.stepMillis);
    }
}
