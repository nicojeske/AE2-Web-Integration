package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;

/** {@link ItemHistoryStore} sampling every item of a grid into the history database and reading it back. */
class ItemHistoryDbTest {

    private static final String IRON = "minecraft:iron_ingot";
    private static final String GOLD = "minecraft:gold_ingot";
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long START = 490_000 * HOUR;
    private static final String GRID = "grid";

    @BeforeEach
    void setUp() {
        Config.INSTANCE.statistics.sampleIntervalMinutes = 60; // 1h fine buckets
        Config.INSTANCE.statistics.fineRetentionDays = 1; // 24 fine buckets
        Config.INSTANCE.statistics.hourlyRetentionDays = 10;
    }

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
        Config.INSTANCE.statistics.sampleIntervalMinutes = 5;
        Config.INSTANCE.statistics.fineRetentionDays = 30;
        Config.INSTANCE.statistics.hourlyRetentionDays = 365;
    }

    private static void sample(int hour, IStackList storage) {
        ItemHistoryStore.sample(GRID, storage, START + hour * HOUR + 60_000L);
    }

    /** Twelve hourly samples with value changes, an item appearing late and a three-hour outage. */
    private static void sampleScenario() {
        long[] iron = { 5, 5, 6, 6, 6, -1, -1, -1, 6, 9, 9, 9 };
        for (int h = 0; h < iron.length; h++) {
            if (iron[h] < 0) {
                continue; // server offline
            }
            sample(
                h,
                h < 4 ? TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, iron[h]))
                    : TrackingTestFakes
                        .stackList(TrackingTestFakes.stack(IRON, iron[h]), TrackingTestFakes.stack(GOLD, 2)));
        }
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

    private static JSON_ItemHistory read(List<String> items, long from, long to, int points) {
        return ItemHistoryStore.readSeries(HistoryDb.get(), GRID, items, from, to, points);
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void changesGapsAndLateItemsReadBack(Flavor flavor) {
        HistoryDbTestSupport.start(flavor);
        sampleScenario();
        HistoryDbTestSupport.flush();

        List<String> items = Arrays.asList(IRON, GOLD, "minecraft:never_stored");
        long end = START + 11 * HOUR + 60_000L;
        assertEquals(
            "fine -7200000..39600000/3600000" + " minecraft:iron_ingot=[-1, -1, 5, 5, 6, 6, 6, -1, -1, -1, 6, 9, 9, 9]"
                + " minecraft:gold_ingot=[-1, -1, -1, -1, -1, -1, 2, -1, -1, -1, 2, 2, 2, 2]"
                + " minecraft:never_stored=[-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]",
            describe(read(items, START - 2 * HOUR, end, 100)));
        // Downsampled: each window reports the value at its newest sampled bucket.
        assertEquals(
            "fine 0..39600000/10800000" + " minecraft:iron_ingot=[6, 6, 6, 9]"
                + " minecraft:gold_ingot=[-1, 2, 2, 2]"
                + " minecraft:never_stored=[-1, -1, -1, -1]",
            describe(read(items, START, end, 4)));
        // Longer than the fine tier's day: the hourly tier answers.
        JSON_ItemHistory hourly = read(items, end - 3 * 24 * HOUR, end, 20);
        assertEquals("hourly", hourly.resolution);
        long[] ironHourly = hourly.series.get(0).points;
        assertEquals(9, ironHourly[ironHourly.length - 1]);
    }

    @Test
    void anItemThatLeavesStorageReadsZeroNotItsLastCount() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        sample(0, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 5)));
        sample(1, TrackingTestFakes.stackList());
        sample(2, TrackingTestFakes.stackList());
        HistoryDbTestSupport.flush();

        assertEquals(
            "[5, 0, 0]",
            Arrays.toString(read(Collections.singletonList(IRON), START, START + 2 * HOUR, 10).series.get(0).points));
    }

    @Test
    void anItemThatLeftWhileTheServerWasDownReadsZeroAfterARestart() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        sample(0, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 5)));
        HistoryDbTestSupport.flush();

        HistoryDbTestSupport.restart(Flavor.TIMESCALE);
        // The writer learns the known series once it connected; a flush waits for that.
        HistoryDbTestSupport.flush();
        sample(1, TrackingTestFakes.stackList(TrackingTestFakes.stack(GOLD, 1)));
        HistoryDbTestSupport.flush();

        assertEquals(
            "[5, 0]",
            Arrays.toString(read(Collections.singletonList(IRON), START, START + HOUR, 10).series.get(0).points));
    }

    @Test
    void aCraftOnlyEntryCreatesNoSeries() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        sample(0, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 0)));
        HistoryDbTestSupport.flush();

        assertEquals(0, HistoryDbTestSupport.rowCount(Flavor.TIMESCALE, HistoryTable.ITEM_FINE));
        assertTrue(
            HistoryDb.get()
                .knownKeys(HistoryTable.ITEM_FINE, GRID)
                .isEmpty());
    }

    @Test
    void unchangedCountsAreNotWrittenAgain() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        for (int h = 0; h < 4; h++) {
            sample(h, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 5)));
        }
        HistoryDbTestSupport.flush();

        assertEquals(1, HistoryDbTestSupport.rowCount(Flavor.TIMESCALE, HistoryTable.ITEM_FINE));
    }

    @Test
    void theLastSeenNameIsKeptAfterTheItemLeft() {
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
        sample(0, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 5, "Iron Ingot")));
        sample(1, TrackingTestFakes.stackList());
        HistoryDbTestSupport.flush();

        JSON_ItemHistory history = read(Arrays.asList(IRON, GOLD), START, START + HOUR, 10);
        assertEquals(Collections.singletonMap(IRON, "Iron Ingot"), history.names);
    }

    @Test
    void withoutADatabaseSamplingIsANoOp() {
        HistoryDbTestSupport.stop();
        assertDoesNotThrow(() -> sample(0, TrackingTestFakes.stackList(TrackingTestFakes.stack(IRON, 5))));
    }
}
