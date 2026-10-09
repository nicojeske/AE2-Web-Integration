package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
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

import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/** GregTech production history in the history database, against both database flavors. */
class GTHistoryDbTest {

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

    // --- Production ---

    private static void record(String machine, UUID owner, String stack, long amount, long at) {
        GTProductionLog
            .record(GTFlow.PRODUCED, machine, "EBF " + machine, owner, stack, "Name of " + stack, amount, false, at);
    }

    private static void recordProduction() {
        for (int h = 0; h < 30; h++) {
            record("m1", ALICE, "ingot", 10 + h, NOW - h * HOUR);
            record("m1", ALICE, "dust", 1, NOW - h * HOUR);
            record("m2", BOB, "ingot", 100, NOW - h * 5 * HOUR);
            GTProductionLog
                .record(GTFlow.CONSUMED, "m1", "EBF m1", ALICE, "dust", "Name of dust", 4, false, NOW - h * HOUR);
        }
        record("m3", null, "plate", 3, NOW - 20 * DAY);
    }

    private static List<String> readProduction() {
        List<String> answers = new ArrayList<>();
        for (long span : new long[] { 5 * HOUR, 3 * DAY, 30 * DAY }) {
            answers.add(rows(GTProductionLog.totals(GTFlow.PRODUCED, NOW - span, NOW, NOW, o -> true, null)));
            answers
                .add(rows(GTProductionLog.totals(GTFlow.PRODUCED, NOW - span, NOW, NOW, o -> ALICE.equals(o), null)));
            answers.add(rows(GTProductionLog.totals(GTFlow.PRODUCED, NOW - span, NOW, NOW, o -> true, "m2")));
            answers.add(
                describe(GTProductionLog.series(GTFlow.PRODUCED, "ingot", null, NOW - span, NOW, NOW, 6, o -> true)));
            answers
                .add(describe(GTProductionLog.series(GTFlow.PRODUCED, null, "m1", NOW - span, NOW, NOW, 6, o -> true)));
            answers.add(
                describe(
                    GTProductionLog
                        .series(GTFlow.PRODUCED, "ingot", null, NOW - span, NOW, NOW, 6, o -> BOB.equals(o))));
        }
        for (long span : new long[] { 5 * HOUR, 30 * DAY }) {
            answers.add(rows(GTProductionLog.totals(GTFlow.CONSUMED, NOW - span, NOW, NOW, o -> true, null)));
            answers
                .add(describe(GTProductionLog.series(GTFlow.CONSUMED, null, "m1", NOW - span, NOW, NOW, 6, o -> true)));
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
            "history is never written to JSON files");
    }

    /** Oldest first, so tracking starts 3 days back: m1 is steady, m2 adds an output, m3 stops for a day. */
    private static void recordSteadyProduction() {
        for (int h = 72; h >= 0; h--) {
            record("m1", ALICE, "ingot", 2, NOW - h * HOUR);
            record("m2", BOB, h < 5 ? "plate" : "ingot", 1, NOW - h * HOUR);
            if (h < 24 || h >= 48) {
                record("m3", null, "dust", 4, NOW - h * HOUR);
            }
        }
    }

    @ParameterizedTest
    @EnumSource(Flavor.class)
    void passiveSuggestionsComeFromTheStoredCounters(Flavor flavor) {
        HistoryDbTestSupport.start(flavor);
        GTProductionLog.loadData();
        recordSteadyProduction();
        HistoryDbTestSupport.flush();

        assertEquals(Collections.singleton("m1"), GTPassiveDetector.compute(NOW));
    }
}
