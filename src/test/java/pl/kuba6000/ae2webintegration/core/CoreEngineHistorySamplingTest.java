package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;

/**
 * {@code CoreEngine.runHistorySampling}'s resumable-cursor sampler, modelled on
 * {@code CoreEngineMaintenanceTest}: the interval gate, one grid sampled per tick, every usable grid part of
 * a pass, no pass at all without a history database, and a grid going offline mid-pass not failing the rest
 * of it.
 */
class CoreEngineHistorySamplingTest extends GridTestScope {

    private static final String ITEM = "minecraft:iron_ingot";
    /** Recent, since the sampler's maintenance prunes by the real clock; hour-aligned for whole buckets. */
    private static final long BASE = Math.floorDiv(System.currentTimeMillis(), TimeUnit.HOURS.toMillis(1))
        * TimeUnit.HOURS.toMillis(1);

    @BeforeEach
    void setUp() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        CoreEngine.resetHistorySamplingForTest();
        AE2Controller.AE2Interface = TestGridFixtures.ae();
    }

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
    }

    /** The stable key the registry assigned to the grid at {@code position}. */
    private static String keyOf(TestGridFixtures.TestGrid grid) {
        return TestGridFixtures.resolvedKey(grid)
            .toString();
    }

    private static TestGridFixtures.TestGrid storingGrid(long position, long storedAmount) {
        return TestGridFixtures.grid(position)
            .withStorage(new TestGridFixtures.TestStack(ITEM, storedAmount));
    }

    private static long sampledValue(String gridKey, long nowMillis) {
        HistoryDbTestSupport.flush();
        JSON_ItemHistory result = ItemHistoryStore
            .readSeries(HistoryDb.get(), gridKey, Arrays.asList(ITEM), nowMillis, nowMillis, 1);
        long[] points = result.series.get(0).points;
        return points[points.length - 1];
    }

    @Test
    void onePassSamplesExactlyOneGridPerTick() {
        TestGridFixtures.TestGrid a = storingGrid(980_101L, 10L);
        TestGridFixtures.TestGrid b = storingGrid(980_102L, 20L);
        TestGridFixtures.TestGrid c = storingGrid(980_103L, 30L);
        AE2Controller.AE2Interface = TestGridFixtures.ae(a, b, c);
        long nowMillis = BASE + 1_000_000L;
        String[] keys = { keyOf(a), keyOf(b), keyOf(c) };

        CoreEngine.runHistorySampling(0L, nowMillis);
        assertEquals(1, countSampled(keys, nowMillis), "exactly one grid must be sampled per tick");

        CoreEngine.runHistorySampling(0L, nowMillis);
        assertEquals(2, countSampled(keys, nowMillis));

        CoreEngine.runHistorySampling(0L, nowMillis);
        assertEquals(3, countSampled(keys, nowMillis));
    }

    private static long countSampled(String[] gridKeys, long nowMillis) {
        long count = 0;
        for (String gridKey : gridKeys) {
            if (sampledValue(gridKey, nowMillis) != ItemHistoryStore.NO_SAMPLE) {
                count++;
            }
        }
        return count;
    }

    @Test
    void withoutAHistoryDatabaseNoPassRuns() {
        TestGridFixtures.TestGrid grid = storingGrid(980_201L, 10L);
        String gridKey = keyOf(grid);
        AE2Controller.AE2Interface = TestGridFixtures.ae(grid);
        HistoryDbTestSupport.stop();

        long nowMillis = BASE + 2_000_000L;
        assertDoesNotThrow(() -> CoreEngine.runHistorySampling(0L, nowMillis));

        HistoryDbTestSupport.restart(Flavor.TIMESCALE);
        assertEquals(ItemHistoryStore.NO_SAMPLE, sampledValue(gridKey, nowMillis));
    }

    @Test
    void aGridThatGoesOfflineMidPassIsSkippedWithoutFailingThePass() {
        TestGridFixtures.TestGrid a = storingGrid(980_301L, 10L);
        TestGridFixtures.TestGrid b = storingGrid(980_302L, 20L);
        String gridA = keyOf(a), gridB = keyOf(b);
        AE2Controller.AE2Interface = TestGridFixtures.ae(a, b);

        long nowMillis = BASE + 3_000_000L;
        CoreEngine.runHistorySampling(0L, nowMillis); // samples one of the two grids

        // Grid B drops off the network between ticks of the same pass.
        b.noController();
        AE2Controller.AE2Interface = TestGridFixtures.ae(a);

        assertDoesNotThrow(() -> CoreEngine.runHistorySampling(0L, nowMillis));

        assertEquals(10L, sampledValue(gridA, nowMillis));
        assertEquals(ItemHistoryStore.NO_SAMPLE, sampledValue(gridB, nowMillis));
    }

    @Test
    void anotherPassDoesNotStartUntilTheConfiguredIntervalElapses() {
        TestGridFixtures.TestGrid grid = storingGrid(980_401L, 10L);
        String gridKey = keyOf(grid);
        AE2Controller.AE2Interface = TestGridFixtures.ae(grid);

        long intervalNanos = TimeUnit.MINUTES.toNanos(5); // default statistics_sample_interval_minutes
        CoreEngine.runHistorySampling(0L, BASE + 4_000_000L);
        assertEquals(10L, sampledValue(gridKey, BASE + 4_000_000L));

        // Stock changes, but re-running just after the pass closed, still inside the interval, must not
        // start a new pass.
        grid.withStorage(new TestGridFixtures.TestStack(ITEM, 99L));
        CoreEngine.runHistorySampling(intervalNanos - 1, BASE + 5_000_000L);
        assertEquals(ItemHistoryStore.NO_SAMPLE, sampledValue(gridKey, BASE + 5_000_000L));

        // Once the interval has elapsed, the next tick samples again at the new nowMillis.
        CoreEngine.runHistorySampling(intervalNanos, BASE + 5_000_000L);
        assertEquals(99L, sampledValue(gridKey, BASE + 5_000_000L));
    }
}
