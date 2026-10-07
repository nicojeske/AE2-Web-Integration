package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;

class GTProductionLogTest {

    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long DAY = TimeUnit.DAYS.toMillis(1);
    /** A fixed "now" on an hour boundary plus 30 minutes, far from epoch so day buckets are realistic. */
    private static final long NOW = 20_000 * DAY + 10 * HOUR + 30 * 60_000L;
    private static final UUID ALICE = GTTestSupport.uuid("alice");
    private static final UUID BOB = GTTestSupport.uuid("bob");

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    private static void record(String machine, UUID owner, String stack, long amount, long at) {
        GTProductionLog.record(machine, "EBF " + machine, owner, stack, "Name of " + stack, amount, false, at);
    }

    @Test
    void totalsSumPerMachineAndStackWithinRange() {
        record("m1", ALICE, "gregtech:ingot:1", 10, NOW);
        record("m1", ALICE, "gregtech:ingot:1", 5, NOW - HOUR);
        record("m1", ALICE, "gregtech:ingot:1", 1000, NOW - 3 * HOUR);
        record("m2", ALICE, "gregtech:ingot:1", 7, NOW);

        List<GTProductionLog.Row> rows = GTProductionLog.totals(NOW - HOUR, NOW, NOW, owner -> true, null);

        assertEquals(2, rows.size());
        long m1 = rows.stream()
            .filter(r -> r.machineId.equals("m1"))
            .findFirst()
            .get().total;
        assertEquals(15, m1);
        assertEquals(
            "EBF m1",
            rows.stream()
                .filter(r -> r.machineId.equals("m1"))
                .findFirst()
                .get().machineName);
    }

    @Test
    void ownerFilterHidesOtherPlayersMachines() {
        record("m1", ALICE, "a", 1, NOW);
        record("m2", BOB, "a", 1, NOW);

        List<GTProductionLog.Row> rows = GTProductionLog.totals(NOW - HOUR, NOW, NOW, ALICE::equals, null);

        assertEquals(1, rows.size());
        assertEquals("m1", rows.get(0).machineId);
    }

    @Test
    void nonPositiveAmountsAndMissingIdsAreIgnored() {
        record("m1", ALICE, "a", 0, NOW);
        record("m1", ALICE, "a", -5, NOW);
        GTProductionLog.record(null, null, ALICE, "a", null, 5, false, NOW);
        GTProductionLog.record("m1", null, ALICE, null, null, 5, false, NOW);

        assertTrue(
            GTProductionLog.totals(NOW - DAY, NOW, NOW, o -> true, null)
                .isEmpty());
        assertEquals(0L, GTProductionLog.trackingSinceMillis());
    }

    @Test
    void rangesBeyondHourlyRetentionUseDailyBuckets() {
        ConfigBootstrap.gtProductionHourlyRetentionDaysValue = () -> 1;
        record("m1", ALICE, "a", 3, NOW - 5 * DAY);
        record("m1", ALICE, "a", 4, NOW);

        assertTrue(GTProductionLog.useHourly(NOW - HOUR, NOW));
        assertTrue(!GTProductionLog.useHourly(NOW - 10 * DAY, NOW));
        assertEquals(
            7,
            GTProductionLog.totals(NOW - 10 * DAY, NOW, NOW, o -> true, null)
                .get(0).total);
    }

    @Test
    void pruneDropsExpiredBucketsAndEmptyMachines() {
        ConfigBootstrap.gtProductionHourlyRetentionDaysValue = () -> 1;
        ConfigBootstrap.gtProductionDailyRetentionDaysValue = () -> 2;
        record("old", ALICE, "a", 3, NOW - 10 * DAY);
        record("new", ALICE, "a", 4, NOW);

        GTProductionLog.prune(NOW);

        List<GTProductionLog.Row> rows = GTProductionLog.totals(NOW - 90 * DAY, NOW, NOW, o -> true, null);
        assertEquals(1, rows.size());
        assertEquals("new", rows.get(0).machineId);
    }

    @Test
    void seriesSumsPerWindowAcrossVisibleMachines() {
        record("m1", ALICE, "a", 1, NOW - 2 * HOUR);
        record("m2", ALICE, "a", 2, NOW - 2 * HOUR);
        record("m1", ALICE, "a", 4, NOW);
        record("m1", ALICE, "b", 100, NOW);
        record("m3", BOB, "a", 1000, NOW);

        GTProductionLog.Series series = GTProductionLog.series("a", null, NOW - 2 * HOUR, NOW, NOW, 120, ALICE::equals);

        assertEquals("hourly", series.resolution);
        assertArrayEquals(new long[] { 3, 0, 4 }, series.points);
        assertEquals(HOUR, series.stepMillis);
    }

    @Test
    void seriesDownsamplesBySumming() {
        for (int h = 0; h < 6; h++) {
            record("m1", ALICE, "a", 1, NOW - h * HOUR);
        }
        GTProductionLog.Series series = GTProductionLog.series("a", "m1", NOW - 5 * HOUR, NOW, NOW, 3, o -> true);

        assertArrayEquals(new long[] { 2, 2, 2 }, series.points);
        assertEquals(2 * HOUR, series.stepMillis);
    }

    @Test
    void persistenceRoundTrip() {
        record("m1", ALICE, "a", 42, NOW);
        GTProductionLog.saveNow();
        GTProductionLog.clear();

        GTProductionLog.loadData();

        List<GTProductionLog.Row> rows = GTProductionLog.totals(NOW - HOUR, NOW, NOW, o -> true, null);
        assertEquals(1, rows.size());
        assertEquals(42, rows.get(0).total);
        assertEquals(ALICE, rows.get(0).owner);
        assertEquals("Name of a", rows.get(0).stackName);
        assertEquals(NOW, GTProductionLog.trackingSinceMillis());
    }
}
