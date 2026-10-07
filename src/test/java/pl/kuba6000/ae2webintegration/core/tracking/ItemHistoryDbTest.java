package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/**
 * {@link ItemHistoryStore} with a history database: the same samples must read back exactly as they do from
 * the in-memory rings, and {@code itemhistory.json} must import without changing what the API answers.
 */
class ItemHistoryDbTest {

    private static final String IRON = "minecraft:iron_ingot";
    private static final String GOLD = "minecraft:gold_ingot";
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long START = 490_000 * HOUR;

    private static long nextGridKey = 980_000L;

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        ConfigBootstrap.statisticsSampleIntervalMinutesValue = () -> 60; // 1h fine buckets
        ConfigBootstrap.statisticsFineRetentionDaysValue = () -> 1; // 24 fine buckets
        ConfigBootstrap.statisticsHourlyRetentionDaysValue = () -> 10;
    }

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
        ConfigBootstrap.statisticsSampleIntervalMinutesValue = () -> 5;
        ConfigBootstrap.statisticsFineRetentionDaysValue = () -> 30;
        ConfigBootstrap.statisticsHourlyRetentionDaysValue = () -> 365;
    }

    private static Set<String> tracked() {
        return new HashSet<>(Arrays.asList(IRON, GOLD));
    }

    /** Twelve hourly samples with value changes, an item missing from storage and a three-hour outage. */
    private static void sampleScenario(long gridKey) {
        long[] iron = { 5, 5, 6, 6, 6, -1, -1, -1, 6, 9, 9, 9 };
        for (int h = 0; h < iron.length; h++) {
            if (iron[h] < 0) {
                continue; // server offline
            }
            ItemHistoryStore.sample(
                gridKey,
                tracked(),
                h < 4 ? TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, iron[h]))
                    : TrackingTestFakes
                        .stackList(TrackingTestFakes.stack(IRON, iron[h]), TrackingTestFakes.stack(GOLD, 2)),
                START + h * HOUR + 60_000L);
        }
    }

    private static List<String> readScenario(long gridKey) {
        List<String> answers = new ArrayList<>();
        List<String> items = Arrays.asList(IRON, GOLD, "minecraft:never_tracked");
        long end = START + 11 * HOUR + 60_000L;
        answers.add(describe(ItemHistoryStore.readSeries(gridKey, items, START - 2 * HOUR, end, 100)));
        answers.add(describe(ItemHistoryStore.readSeries(gridKey, items, START, end, 4)));
        // Longer than the fine tier's day: the hourly tier answers.
        answers.add(describe(ItemHistoryStore.readSeries(gridKey, items, end - 3 * 24 * HOUR, end, 20)));
        return answers;
    }

    private static String describe(JSON_ItemHistory history) {
        StringBuilder text = new StringBuilder(
            history.resolution + " " + (history.from - START) + ".." + (history.to - START) + "/" + history.stepMillis);
        for (JSON_ItemHistory.JSON_ItemSeries series : history.series) {
            text.append(" ")
                .append(series.itemid)
                .append("=")
                .append(Arrays.toString(series.points));
        }
        return text.toString();
    }

    private static void flush() {
        HistoryDbTestSupport.flush();
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void theDatabaseAnswersExactlyLikeTheInMemoryRings(Flavor flavor) {
        long memoryGrid = nextGridKey++;
        sampleScenario(memoryGrid);
        List<String> expected = readScenario(memoryGrid);
        // Guards the comparison itself: gaps, changes and the late-appearing item are really in there.
        assertEquals(
            "fine -7200000..39600000/3600000" + " minecraft:iron_ingot=[-1, -1, 5, 5, 6, 6, 6, -1, -1, -1, 6, 9, 9, 9]"
                + " minecraft:gold_ingot=[-1, -1, 0, 0, 0, 0, 2, -1, -1, -1, 2, 2, 2, 2]"
                + " minecraft:never_tracked=[-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]",
            expected.get(0));

        HistoryDbTestSupport.start(flavor);
        long dbGrid = nextGridKey++;
        sampleScenario(dbGrid);
        flush();

        assertEquals(expected, readScenario(dbGrid));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void pruneToDropsUntrackedItemsLikeTheRingsDo(Flavor flavor) {
        long memoryGrid = nextGridKey++;
        sampleScenario(memoryGrid);
        ItemHistoryStore.pruneTo(memoryGrid, Collections.singleton(IRON));
        List<String> expected = readScenario(memoryGrid);

        HistoryDbTestSupport.start(flavor);
        long dbGrid = nextGridKey++;
        sampleScenario(dbGrid);
        ItemHistoryStore.pruneTo(dbGrid, Collections.singleton(IRON));
        flush();

        assertEquals(expected, readScenario(dbGrid));
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void theJsonFileIsImportedOnceAndKeptUnderANewName(Flavor flavor) {
        long gridKey = nextGridKey++;
        sampleScenario(gridKey);
        List<String> expected = readScenario(gridKey);
        ItemHistoryStore.saveNow();
        File json = Config.getConfigFile("itemhistory.json");
        assertTrue(json.exists());

        HistoryDbTestSupport.start(flavor);
        ItemHistoryStore.loadData();
        flush();

        assertEquals(expected, readScenario(gridKey));
        assertFalse(json.exists(), "the imported file is renamed");
        assertTrue(new File(json.getParentFile(), "itemhistory.json.migrated").exists());

        // Sampling continues seamlessly on top of the imported history.
        ItemHistoryStore.sample(
            gridKey,
            tracked(),
            TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 9)),
            START + 12 * HOUR + 60_000L);
        flush();
        JSON_ItemHistory latest = ItemHistoryStore
            .readSeries(gridKey, Collections.singletonList(IRON), START + 11 * HOUR, START + 12 * HOUR, 10);
        assertEquals("[9, 9]", Arrays.toString(latest.series.get(0).points));
    }
}
