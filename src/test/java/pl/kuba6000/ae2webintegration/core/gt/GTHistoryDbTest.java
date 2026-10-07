package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/**
 * GregTech power and production history with a history database: the same recordings must read back exactly
 * as from memory, and the JSON files must import without changing what the API answers.
 */
class GTHistoryDbTest {

    private static final long SECOND = 1000L;
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long DAY = TimeUnit.DAYS.toMillis(1);
    private static final long NOW = 20_352 * DAY + 10 * HOUR + 30 * 60_000L;
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
        HistoryDbTestSupport.stop();
        GTTestSupport.reset();
    }

    // --- Power ---

    private static void recordPower() {
        for (int i = 0; i < 20; i++) {
            long at = NOW - (20 - i) * 30 * SECOND - (i >= 12 ? 0 : 5 * 60 * SECOND); // a 5-minute outage
            GTPowerSourceSnapshot lsc = GTTestSupport.lsc(1, ALICE, 1000 + i / 3 * 10, 100_000, 50L + i, 40L);
            GTPowerSourceSnapshot wireless = GTTestSupport.wireless(BOB, BigInteger.valueOf(7_000 + i));
            GTPowerHistoryStore.recordSample(Arrays.asList(lsc, wireless), at);
        }
    }

    private static List<String> readPower() {
        List<String> answers = new ArrayList<>();
        String lsc = GTTestSupport.lsc(1, ALICE, 0, 1, null, null).id;
        String wireless = GTTestSupport.wireless(BOB, BigInteger.ZERO).id;
        for (String id : Arrays.asList(lsc, wireless)) {
            answers.add(describe(GTPowerHistoryStore.read(id, NOW - 20 * 60 * SECOND, NOW, 100)));
            answers.add(describe(GTPowerHistoryStore.read(id, NOW - 20 * 60 * SECOND, NOW, 7)));
            answers.add(describe(GTPowerHistoryStore.read(id, NOW - 3 * DAY, NOW, 50)));
        }
        return answers;
    }

    private static String describe(GTPowerHistoryStore.Series s) {
        return s.source + " "
            + s.resolution
            + " "
            + s.from
            + ".."
            + s.to
            + "/"
            + s.stepMillis
            + " stored="
            + Arrays.toString(s.stored)
            + " in="
            + Arrays.toString(s.avgIn)
            + " out="
            + Arrays.toString(s.avgOut);
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void powerHistoryReadsBackExactlyLikeMemory(Flavor flavor) {
        recordPower();
        List<String> expected = readPower();
        assertTrue(
            expected.get(0)
                .contains("stored=[-1"),
            "the outage is part of the scenario");
        GTTestSupport.reset();

        HistoryDbTestSupport.start(flavor);
        recordPower();
        HistoryDbTestSupport.flush();

        assertEquals(expected, readPower());
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void powerJsonIsImported(Flavor flavor) {
        recordPower();
        List<String> expected = readPower();
        GTPowerHistoryStore.saveNow();
        GTTestSupport.reset();
        File json = Config.getConfigFile("gtpower.json");
        assertTrue(json.exists());

        HistoryDbTestSupport.start(flavor);
        GTPowerHistoryStore.loadData();
        HistoryDbTestSupport.flush();

        assertEquals(expected, readPower());
        assertFalse(json.exists());
        assertTrue(new File(json.getParentFile(), "gtpower.json.migrated").exists());
    }

    // --- Production ---

    private static void record(String machine, UUID owner, String stack, long amount, long at) {
        GTProductionLog.record(machine, "EBF " + machine, owner, stack, "Name of " + stack, amount, false, at);
    }

    private static void recordProduction() {
        for (int h = 0; h < 30; h++) {
            record("m1", ALICE, "ingot", 10 + h, NOW - h * HOUR);
            record("m1", ALICE, "dust", 1, NOW - h * HOUR);
            record("m2", BOB, "ingot", 100, NOW - h * 5 * HOUR);
        }
        record("m3", null, "plate", 3, NOW - 20 * DAY);
    }

    private static List<String> readProduction() {
        List<String> answers = new ArrayList<>();
        for (long span : new long[] { 5 * HOUR, 3 * DAY, 30 * DAY }) {
            answers.add(rows(GTProductionLog.totals(NOW - span, NOW, NOW, o -> true, null)));
            answers.add(rows(GTProductionLog.totals(NOW - span, NOW, NOW, o -> ALICE.equals(o), null)));
            answers.add(rows(GTProductionLog.totals(NOW - span, NOW, NOW, o -> true, "m2")));
            answers.add(describe(GTProductionLog.series("ingot", null, NOW - span, NOW, NOW, 6, o -> true)));
            answers.add(describe(GTProductionLog.series(null, "m1", NOW - span, NOW, NOW, 6, o -> true)));
            answers.add(describe(GTProductionLog.series("ingot", null, NOW - span, NOW, NOW, 6, o -> BOB.equals(o))));
        }
        answers.add("since " + GTProductionLog.trackingSinceMillis());
        return answers;
    }

    private static String rows(List<GTProductionLog.Row> rows) {
        return rows.stream()
            .map(
                r -> r.machineId + "/"
                    + r.machineName
                    + "/"
                    + r.owner
                    + "/"
                    + r.stackId
                    + "/"
                    + r.stackName
                    + "/"
                    + r.fluid
                    + "="
                    + r.total)
            .sorted()
            .collect(Collectors.toList())
            .toString();
    }

    private static String describe(GTProductionLog.Series s) {
        return s.stack + " "
            + s.machine
            + " "
            + s.resolution
            + " "
            + s.from
            + ".."
            + s.to
            + "/"
            + s.stepMillis
            + " "
            + Arrays.toString(s.points);
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void productionReadsBackExactlyLikeMemory(Flavor flavor) {
        recordProduction();
        List<String> expected = readProduction();
        assertTrue(
            expected.get(0)
                .contains("m1/EBF m1/"),
            "names are part of the comparison");
        GTTestSupport.reset();

        HistoryDbTestSupport.start(flavor);
        GTProductionLog.loadData();
        recordProduction();
        HistoryDbTestSupport.flush();

        assertEquals(expected, readProduction());
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void productionJsonIsImportedWithItsNamesAndOwners(Flavor flavor) {
        recordProduction();
        List<String> expected = readProduction();
        GTProductionLog.saveNow();
        GTTestSupport.reset();
        File json = Config.getConfigFile("gtproduction.json");
        assertTrue(json.exists());

        HistoryDbTestSupport.start(flavor);
        GTProductionLog.loadData();
        HistoryDbTestSupport.flush();

        assertEquals(expected, readProduction());
        assertFalse(json.exists());
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void productionNamesAndOwnersSurviveARestart(Flavor flavor) {
        HistoryDbTestSupport.start(flavor);
        GTProductionLog.loadData();
        HistoryDbTestSupport.flush();
        recordProduction();
        GTProductionLog.saveNow();
        HistoryDbTestSupport.flush();
        List<String> expected = readProduction();

        GTTestSupport.reset();
        HistoryDbTestSupport.restart(flavor);
        GTProductionLog.loadData();
        HistoryDbTestSupport.flush();

        assertEquals(expected, readProduction());
        assertEquals(
            Collections.emptyList(),
            Arrays.asList(configRoot.listFiles((dir, name) -> name.endsWith(".json"))),
            "nothing is written to JSON files in database mode");
    }
}
