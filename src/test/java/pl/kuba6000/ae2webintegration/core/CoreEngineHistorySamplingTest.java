package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;

/**
 * {@code CoreEngine.runHistorySampling}'s resumable-cursor sampler, modelled on
 * {@code CoreEngineMaintenanceTest}: the interval gate, one grid sampled per tick, grids with no tracked
 * items excluded from a pass, and a grid going offline mid-pass not failing the rest of it.
 * <p>
 * Every test method uses its own grid key range - {@code GridData}'s map and {@code ItemHistoryStore}'s
 * map are both static for the whole test JVM, and unlike {@code isTracked}, a grid's tracked-item set
 * would otherwise silently carry over between test methods.
 */
class CoreEngineHistorySamplingTest extends GridTestScope {

    private static final String ITEM = "minecraft:iron_ingot";

    @BeforeEach
    void setUp() {
        ItemHistoryStore.clearRuntimeState();
        CoreEngine.resetHistorySamplingForTest();
        AE2Controller.AE2Interface = TestGridFixtures.ae();
    }

    /** The stable key the registry assigned to the grid at {@code position}. */
    private static String keyOf(TestGridFixtures.TestGrid grid) {
        return TestGridFixtures.resolvedKey(grid)
            .toString();
    }

    private static TestGridFixtures.TestGrid trackedGrid(long position, long storedAmount) {
        TestGridFixtures.TestGrid grid = TestGridFixtures.grid(position)
            .withStorage(new TestGridFixtures.TestStack(ITEM, storedAmount));
        synchronized (CoreEngine.GRID_IDENTITIES) {
            CoreEngine.GRID_IDENTITIES.getPersistentData(TestGridFixtures.resolvedKey(grid))
                .getSettings()
                .setTrackedItems(Arrays.asList(ITEM));
        }
        return grid;
    }

    private static long sampledValue(String gridKey, long nowMillis) {
        JSON_ItemHistory result = ItemHistoryStore.readSeries(gridKey, Arrays.asList(ITEM), nowMillis, nowMillis, 1);
        long[] points = result.series.get(0).points;
        return points[points.length - 1];
    }

    @Test
    void onePassSamplesExactlyOneGridPerTick() {
        TestGridFixtures.TestGrid a = trackedGrid(980_101L, 10L);
        TestGridFixtures.TestGrid b = trackedGrid(980_102L, 20L);
        TestGridFixtures.TestGrid c = trackedGrid(980_103L, 30L);
        AE2Controller.AE2Interface = TestGridFixtures.ae(a, b, c);
        long nowMillis = 1_000_000L;
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
    void aGridWithNoTrackedItemsIsNeverSampled() {
        TestGridFixtures.TestGrid tracked = trackedGrid(980_201L, 10L);
        // Online, but nothing was ever tracked on it.
        TestGridFixtures.TestGrid untracked = TestGridFixtures.grid(980_202L)
            .withStorage(new TestGridFixtures.TestStack(ITEM, 20L));
        String trackedKey = keyOf(tracked), untrackedKey = keyOf(untracked);
        AE2Controller.AE2Interface = TestGridFixtures.ae(tracked, untracked);

        long nowMillis = 2_000_000L;
        // Only one of the two grids qualifies for the pass, so it must close out (and reschedule) after a
        // single tick - not sit waiting for a second tick that would otherwise sample the untracked grid.
        CoreEngine.runHistorySampling(0L, nowMillis);

        assertEquals(10L, sampledValue(trackedKey, nowMillis));
        assertEquals(ItemHistoryStore.NO_SAMPLE, sampledValue(untrackedKey, nowMillis));

        CoreEngine.runHistorySampling(0L, nowMillis + 1);
        assertEquals(10L, sampledValue(trackedKey, nowMillis), "no second sample before the interval elapses");
    }

    @Test
    void aGridThatGoesOfflineMidPassIsSkippedWithoutFailingThePass() {
        TestGridFixtures.TestGrid a = trackedGrid(980_301L, 10L);
        TestGridFixtures.TestGrid b = trackedGrid(980_302L, 20L);
        String gridA = keyOf(a), gridB = keyOf(b);
        AE2Controller.AE2Interface = TestGridFixtures.ae(a, b);

        long nowMillis = 3_000_000L;
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
        TestGridFixtures.TestGrid grid = trackedGrid(980_401L, 10L);
        String gridKey = keyOf(grid);
        AE2Controller.AE2Interface = TestGridFixtures.ae(grid);

        long intervalNanos = TimeUnit.MINUTES.toNanos(5); // default statistics_sample_interval_minutes
        CoreEngine.runHistorySampling(0L, 4_000_000L);
        assertEquals(10L, sampledValue(gridKey, 4_000_000L));

        // Stock changes, but re-running just after the pass closed, still inside the interval, must not
        // start a new pass.
        grid.withStorage(new TestGridFixtures.TestStack(ITEM, 99L));
        CoreEngine.runHistorySampling(intervalNanos - 1, 5_000_000L);
        assertEquals(ItemHistoryStore.NO_SAMPLE, sampledValue(gridKey, 5_000_000L));

        // Once the interval has elapsed, the next tick samples again at the new nowMillis.
        CoreEngine.runHistorySampling(intervalNanos, 5_000_000L);
        assertEquals(99L, sampledValue(gridKey, 5_000_000L));
    }
}
