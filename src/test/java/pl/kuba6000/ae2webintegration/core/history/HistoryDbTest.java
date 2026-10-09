package pl.kuba6000.ae2webintegration.core.history;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/** The {@link HistoryDb} contract against real PostgreSQL, with and without TimescaleDB. */
class HistoryDbTest {

    private static final long MINUTE = TimeUnit.MINUTES.toMillis(1);
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long DAY = TimeUnit.DAYS.toMillis(1);
    /** 2026-09-21, so chunk and retention arithmetic runs on realistic timestamps. */
    private static final long NOW = 20_352 * DAY;
    private static final long FINE = 5 * MINUTE;
    private static final long BASE = NOW / FINE - 100;
    private static final long N = HistoryDb.NO_SAMPLE;

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
    }

    private static void sample(HistoryDb db, String scope, String key, long bucket, long value) {
        db.putGauge(HistoryTable.ITEM_FINE, scope, key, bucket * FINE, value);
        db.markSampled(HistoryTable.ITEM_FINE, scope, bucket * FINE, FINE);
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void aChangeOnlyGaugeStoresOnlyChangesAndReadsThemCarriedForward(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        long[] values = { 10, 10, 10, 20, 20, 10, 10, 10, 10, 10 };
        for (int i = 0; i < values.length; i++) {
            sample(db, "g", "iron", BASE + i, values[i]);
        }
        HistoryDbTestSupport.flush();

        assertEquals(3, HistoryDbTestSupport.rowCount(flavor, HistoryTable.ITEM_FINE));
        assertArrayEquals(values, db.readGauge(HistoryTable.ITEM_FINE, "g", "iron", BASE, BASE + 9, 1, FINE));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void skippedBucketsReadAsGapsNotAsTheCarriedValue(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        for (long bucket : new long[] { 0, 1, 2, 5, 6 }) {
            sample(db, "g", "iron", BASE + bucket, 7);
        }
        db.putGauge(HistoryTable.ITEM_FINE, "g", "gold", (BASE + 5) * FINE, 3);
        db.putGauge(HistoryTable.ITEM_FINE, "g", "gold", (BASE + 6) * FINE, 3);
        HistoryDbTestSupport.flush();

        assertArrayEquals(
            new long[] { N, 7, 7, 7, N, N, 7, 7 },
            db.readGauge(HistoryTable.ITEM_FINE, "g", "iron", BASE - 1, BASE + 6, 1, FINE));
        assertArrayEquals(
            new long[] { N, N, N, N, N, 3, 3 },
            db.readGauge(HistoryTable.ITEM_FINE, "g", "gold", BASE, BASE + 6, 1, FINE),
            "a series that started later has no value before its first row");
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void downsamplingTakesTheNewestSampledValuePerWindow(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        for (int i = 0; i < 5; i++) {
            sample(db, "g", "iron", BASE + i, i + 1);
        }
        HistoryDbTestSupport.flush();

        assertArrayEquals(
            new long[] { 2, 4, 5 },
            db.readGauge(HistoryTable.ITEM_FINE, "g", "iron", BASE, BASE + 5, 2, FINE));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void aChangeOnlyValueIsRewrittenOnceTheAnchorIntervalPassed(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        long anchorBuckets = HistoryTable.ITEM_FINE.anchorMillis() / FINE;
        for (long i = 0; i <= anchorBuckets; i++) {
            sample(db, "g", "iron", BASE + i, 1);
        }
        HistoryDbTestSupport.flush();

        assertEquals(2, HistoryDbTestSupport.rowCount(flavor, HistoryTable.ITEM_FINE));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void aDenseGaugeKeepsEverySampleAndAMissingRowIsAGap(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        long bucket = 30_000L;
        db.putGauge(HistoryTable.POWER_FINE, "lsc", "stored", NOW - 4 * bucket, 5);
        db.putGauge(HistoryTable.POWER_FINE, "lsc", "stored", NOW - 3 * bucket, 5);
        db.putGauge(HistoryTable.POWER_FINE, "lsc", "stored", NOW - bucket, 9);
        db.putGauge(HistoryTable.POWER_FINE, "lsc", "stored", NOW - bucket, 8);
        HistoryDbTestSupport.flush();

        assertEquals(3, HistoryDbTestSupport.rowCount(flavor, HistoryTable.POWER_FINE));
        long from = NOW / bucket - 4;
        assertArrayEquals(
            new long[] { 5, 5, N, 8, N },
            db.readGauge(HistoryTable.POWER_FINE, "lsc", "stored", from, from + 4, 1, bucket));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void countersSumWithinAndAcrossBatchesAndSaturate(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        long hour = NOW / HOUR;
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", hour * HOUR, 5);
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", hour * HOUR, 7);
        HistoryDbTestSupport.flush();
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", hour * HOUR, 3);
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "b", hour * HOUR, Long.MAX_VALUE);
        HistoryDbTestSupport.flush();
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "b", hour * HOUR, 10);
        HistoryDbTestSupport.flush();

        List<HistoryDb.CounterTotal> totals = db
            .readCounterTotals(HistoryTable.PRODUCTION_HOURLY, Collections.singletonList("m1"), hour, hour, HOUR);
        assertEquals(15, total(totals, "m1", "a"));
        assertEquals(Long.MAX_VALUE, total(totals, "m1", "b"));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void counterReadsOnlyCoverTheRequestedScopesKeyAndRange(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        long hour = NOW / HOUR - 3;
        for (int h = 0; h < 4; h++) {
            db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", (hour + h) * HOUR, 1);
            db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "b", (hour + h) * HOUR, 100);
            db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m2", "a", (hour + h) * HOUR, 10);
        }
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", (hour - 1) * HOUR, 1000);
        HistoryDbTestSupport.flush();

        assertArrayEquals(
            new long[] { 22, 22 },
            db.readCounterWindows(
                HistoryTable.PRODUCTION_HOURLY,
                Arrays.asList("m1", "m2"),
                "a",
                hour,
                hour + 3,
                2,
                HOUR));
        assertArrayEquals(
            new long[] { 101, 101, 101, 101 },
            db.readCounterWindows(
                HistoryTable.PRODUCTION_HOURLY,
                Collections.singletonList("m1"),
                null,
                hour,
                hour + 3,
                1,
                HOUR));
        List<HistoryDb.CounterTotal> totals = db
            .readCounterTotals(HistoryTable.PRODUCTION_HOURLY, Collections.singletonList("m1"), hour, hour + 3, HOUR);
        assertEquals(2, totals.size());
        assertEquals(4, total(totals, "m1", "a"));
        assertEquals(400, total(totals, "m1", "b"));
        assertTrue(
            db.readCounterTotals(HistoryTable.PRODUCTION_HOURLY, Collections.emptyList(), hour, hour + 3, HOUR)
                .isEmpty());
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void knownKeysListTheSeriesOfOneScopeAcrossARestart(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        sample(db, "g1", "iron", BASE, 1);
        sample(db, "g1", "gold", BASE, 2);
        sample(db, "g2", "gold", BASE, 3);
        assertEquals(new HashSet<>(Arrays.asList("iron", "gold")), db.knownKeys(HistoryTable.ITEM_FINE, "g1"));
        HistoryDbTestSupport.flush();

        db = HistoryDbTestSupport.restart(flavor);
        HistoryDbTestSupport.flush();
        assertEquals(new HashSet<>(Arrays.asList("iron", "gold")), db.knownKeys(HistoryTable.ITEM_FINE, "g1"));
        assertEquals(Collections.singleton("gold"), db.knownKeys(HistoryTable.ITEM_FINE, "g2"));
        assertTrue(
            db.knownKeys(HistoryTable.ITEM_HOURLY, "g1")
                .isEmpty());
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void seriesNamesAreStoredPerScope(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        db.putName(HistoryTable.ITEM_FINE, "g1", "iron", "Iron Ingot");
        db.putName(HistoryTable.ITEM_FINE, "g1", "iron", "Iron Ingot (renamed)");
        db.putName(HistoryTable.ITEM_FINE, "g2", "iron", "Other grid");
        HistoryDbTestSupport.flush();

        assertEquals(
            Collections.singletonMap("iron", "Iron Ingot (renamed)"),
            db.readNames(HistoryTable.ITEM_FINE, "g1", Arrays.asList("iron", "gold")));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void pruneDropsDataOlderThanTheCutoff(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", NOW - 100 * DAY, 1);
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", NOW, 1);
        HistoryDbTestSupport.flush();

        db.prune(HistoryTable.PRODUCTION_HOURLY, NOW - 30 * DAY, NOW);
        HistoryDbTestSupport.flush();

        assertEquals(1, HistoryDbTestSupport.rowCount(flavor, HistoryTable.PRODUCTION_HOURLY));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void metaValuesRoundTrip(Flavor flavor) {
        HistoryDb db = HistoryDbTestSupport.start(flavor);
        AtomicReference<String> stored = new AtomicReference<>();
        AtomicReference<String> missing = new AtomicReference<>("not called");
        db.putMeta("names", "{\"a\":1}");
        db.loadMeta("names", stored::set);
        db.loadMeta("nothing", missing::set);
        HistoryDbTestSupport.flush();

        assertEquals("{\"a\":1}", stored.get());
        assertNull(missing.get());
    }

    @Test
    void withTimescaleEverySampleTableIsACompressedHypertable() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        HistoryDbTestSupport.flush();

        assertEquals(
            HistoryTable.values().length,
            HistoryDbTestSupport.queryLong(
                Flavor.TIMESCALE,
                "SELECT count(*) FROM timescaledb_information.hypertables"
                    + " WHERE hypertable_name LIKE 'ae2wi_%' AND compression_enabled"));
        // A restart must accept the existing hypertables, and keep writing to them.
        HistoryDb db = HistoryDbTestSupport.restart(Flavor.TIMESCALE);
        db.addCounter(HistoryTable.PRODUCTION_HOURLY, "m1", "a", NOW, 1);
        HistoryDbTestSupport.flush();
        assertEquals(1, HistoryDbTestSupport.rowCount(Flavor.TIMESCALE, HistoryTable.PRODUCTION_HOURLY));
    }

    @Test
    void anUnreachableDatabaseNeverBlocksWritersAndReadsAnswerEmpty() {
        HistoryDb db = HistoryDbTestSupport.startUnreachable();
        long started = System.nanoTime();
        for (int i = 0; i < 10_000; i++) {
            sample(db, "g", "item" + (i % 50), BASE + i / 50, i);
        }
        assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(2), "enqueueing must not wait");
        assertFalse(db.flush(500), "nothing can be committed");

        assertArrayEquals(
            new long[] { N, N },
            db.readGauge(HistoryTable.ITEM_FINE, "g", "item1", BASE, BASE + 1, 1, FINE));
        assertEquals(
            0,
            db.readCounterTotals(HistoryTable.PRODUCTION_HOURLY, Collections.singletonList("m"), 0, 1, HOUR)
                .size());
    }

    private static long total(List<HistoryDb.CounterTotal> totals, String scope, String key) {
        for (HistoryDb.CounterTotal total : totals) {
            if (total.scope.equals(scope) && total.key.equals(key)) {
                return total.total;
            }
        }
        return 0L;
    }
}
