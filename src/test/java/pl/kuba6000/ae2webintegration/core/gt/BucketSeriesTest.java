package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class BucketSeriesTest {

    @Test
    void addAccumulatesAndSumIsInclusive() {
        BucketSeries series = new BucketSeries();
        series.add(10, 5);
        series.add(10, 7);
        series.add(12, 1);
        series.add(20, 100);

        assertEquals(13, series.sum(10, 12));
        assertEquals(12, series.sum(10, 10));
        assertEquals(0, series.sum(13, 19));
        assertEquals(113, series.sum(0, 100));
    }

    @Test
    void newestReturnsLatestInWindowOrMissing() {
        BucketSeries series = new BucketSeries();
        series.set(3, 30);
        series.set(5, 50);

        assertEquals(50, series.newest(0, 9, -1));
        assertEquals(30, series.newest(0, 4, -1));
        assertEquals(-1, series.newest(6, 9, -1));
        assertEquals(-1, series.newest(9, 0, -1));
    }

    @Test
    void pruneDropsOnlyOlderBuckets() {
        BucketSeries series = new BucketSeries();
        series.set(1, 1);
        series.set(2, 2);
        series.set(3, 3);

        assertTrue(series.prune(2));
        assertEquals(5, series.sum(0, 10));
        assertFalse(series.prune(2));
    }

    @Test
    void additionSaturatesInsteadOfWrapping() {
        BucketSeries series = new BucketSeries();
        series.add(1, Long.MAX_VALUE - 1);
        series.add(1, 10);
        series.add(2, 10);

        assertEquals(Long.MAX_VALUE, series.sum(1, 1));
        assertEquals(Long.MAX_VALUE, series.sum(0, 5));
    }

    @Test
    void snapshotRoundTrips() {
        BucketSeries series = new BucketSeries();
        series.add(7, 70);
        BucketSeries copy = BucketSeries.fromSnapshot(series.snapshot());
        assertEquals(70, copy.sum(7, 7));
    }
}
