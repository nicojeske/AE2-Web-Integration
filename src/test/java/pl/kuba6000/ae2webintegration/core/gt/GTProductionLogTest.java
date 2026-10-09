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

import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;

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
        GTTestSupport.startHistory();
        GTProductionLog.loadData();
        // Names are only written back once the stored ones were read.
        GTTestSupport.flushHistory();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    private static void record(String machine, UUID owner, String stack, long amount, long at) {
        GTProductionLog
            .record(GTFlow.PRODUCED, machine, "EBF " + machine, owner, stack, "Name of " + stack, amount, false, at);
    }

    @Test
    void totalsSumPerMachineAndStackWithinRange() {
        record("m1", ALICE, "gregtech:ingot:1", 10, NOW);
        record("m1", ALICE, "gregtech:ingot:1", 5, NOW - HOUR);
        record("m1", ALICE, "gregtech:ingot:1", 1000, NOW - 3 * HOUR);
        record("m2", ALICE, "gregtech:ingot:1", 7, NOW);

        GTTestSupport.flushHistory();
        List<GTProductionLog.Row> rows = GTProductionLog
            .totals(GTFlow.PRODUCED, NOW - HOUR, NOW, NOW, owner -> true, null);

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

        GTTestSupport.flushHistory();
        List<GTProductionLog.Row> rows = GTProductionLog
            .totals(GTFlow.PRODUCED, NOW - HOUR, NOW, NOW, ALICE::equals, null);

        assertEquals(1, rows.size());
        assertEquals("m1", rows.get(0).machineId);
    }

    @Test
    void nonPositiveAmountsAndMissingIdsAreIgnored() {
        record("m1", ALICE, "a", 0, NOW);
        record("m1", ALICE, "a", -5, NOW);
        GTProductionLog.record(GTFlow.PRODUCED, null, null, ALICE, "a", null, 5, false, NOW);
        GTProductionLog.record(GTFlow.PRODUCED, "m1", null, ALICE, null, null, 5, false, NOW);

        GTTestSupport.flushHistory();
        assertTrue(
            GTProductionLog.totals(GTFlow.PRODUCED, NOW - DAY, NOW, NOW, o -> true, null)
                .isEmpty());
        assertEquals(0L, GTProductionLog.trackingSinceMillis());
    }

    @Test
    void rangesBeyondHourlyRetentionUseDailyBuckets() {
        Config.INSTANCE.gregtech.productionHourlyRetentionDays = 1;
        record("m1", ALICE, "a", 3, NOW - 5 * DAY);
        record("m1", ALICE, "a", 4, NOW);

        GTTestSupport.flushHistory();
        assertTrue(GTProductionLog.useHourly(NOW - HOUR, NOW));
        assertTrue(!GTProductionLog.useHourly(NOW - 10 * DAY, NOW));
        assertEquals(
            7,
            GTProductionLog.totals(GTFlow.PRODUCED, NOW - 10 * DAY, NOW, NOW, o -> true, null)
                .get(0).total);
    }

    @Test
    void seriesSumsPerWindowAcrossVisibleMachines() {
        record("m1", ALICE, "a", 1, NOW - 2 * HOUR);
        record("m2", ALICE, "a", 2, NOW - 2 * HOUR);
        record("m1", ALICE, "a", 4, NOW);
        record("m1", ALICE, "b", 100, NOW);
        record("m3", BOB, "a", 1000, NOW);

        GTTestSupport.flushHistory();
        GTProductionLog.Series series = GTProductionLog
            .series(GTFlow.PRODUCED, "a", null, NOW - 2 * HOUR, NOW, NOW, 120, ALICE::equals);

        assertEquals("hourly", series.resolution);
        assertArrayEquals(new long[] { 3, 0, 4 }, series.points);
        assertEquals(HOUR, series.stepMillis);
    }

    @Test
    void seriesDownsamplesBySumming() {
        for (int h = 0; h < 6; h++) {
            record("m1", ALICE, "a", 1, NOW - h * HOUR);
        }
        GTTestSupport.flushHistory();
        GTProductionLog.Series series = GTProductionLog
            .series(GTFlow.PRODUCED, "a", "m1", NOW - 5 * HOUR, NOW, NOW, 3, o -> true);

        assertArrayEquals(new long[] { 2, 2, 2 }, series.points);
        assertEquals(2 * HOUR, series.stepMillis);
    }

    @Test
    void consumedStacksAreKeptApartFromProducedOnes() {
        record("m1", ALICE, "ingot", 10, NOW);
        GTProductionLog.record(GTFlow.CONSUMED, "m1", "EBF m1", ALICE, "dust", "Name of dust", 20, false, NOW);
        GTProductionLog.record(GTFlow.CONSUMED, "m1", "EBF m1", ALICE, "oxygen", "Oxygen", 1000, true, NOW);

        GTTestSupport.flushHistory();
        List<GTProductionLog.Row> produced = GTProductionLog
            .totals(GTFlow.PRODUCED, NOW - HOUR, NOW, NOW, o -> true, null);
        List<GTProductionLog.Row> consumed = GTProductionLog
            .totals(GTFlow.CONSUMED, NOW - HOUR, NOW, NOW, o -> true, "m1");
        assertEquals(1, produced.size());
        assertEquals("ingot", produced.get(0).stackId);
        assertEquals(2, consumed.size());
        assertEquals(
            1020L,
            consumed.stream()
                .mapToLong(r -> r.total)
                .sum());
        assertArrayEquals(
            new long[] { 1020 },
            GTProductionLog.series(GTFlow.CONSUMED, null, "m1", NOW - HOUR / 2, NOW, NOW, 1, o -> true).points);
    }

    @Test
    void namesAndCountersSurviveARestart() {
        record("m1", ALICE, "a", 42, NOW);
        GTProductionLog.record(GTFlow.CONSUMED, "m1", "EBF m1", ALICE, "b", "Name of b", 7, false, NOW);
        GTProductionLog.saveNow();
        GTTestSupport.flushHistory();
        GTProductionLog.clear();

        HistoryDbTestSupport.restart(HistoryDbTestSupport.Flavor.TIMESCALE);
        GTProductionLog.loadData();
        GTTestSupport.flushHistory();

        List<GTProductionLog.Row> rows = GTProductionLog.totals(GTFlow.PRODUCED, NOW - HOUR, NOW, NOW, o -> true, null);
        assertEquals(1, rows.size());
        assertEquals(42, rows.get(0).total);
        assertEquals(ALICE, rows.get(0).owner);
        assertEquals("Name of a", rows.get(0).stackName);
        assertEquals(NOW, GTProductionLog.trackingSinceMillis());
        List<GTProductionLog.Row> consumed = GTProductionLog
            .totals(GTFlow.CONSUMED, NOW - HOUR, NOW, NOW, o -> true, null);
        assertEquals(1, consumed.size());
        assertEquals(7, consumed.get(0).total);
    }

    @Test
    void withoutADatabaseNothingIsRecorded() {
        HistoryDbTestSupport.stop();
        record("m1", ALICE, "a", 42, NOW);

        assertEquals(0L, GTProductionLog.trackingSinceMillis());
        assertTrue(
            GTProductionLog.totals(GTFlow.PRODUCED, NOW - HOUR, NOW, NOW, o -> true, null)
                .isEmpty());
    }
}
