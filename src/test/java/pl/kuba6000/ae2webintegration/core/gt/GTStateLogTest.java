package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.analysis.BottleneckAnalysis;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;

class GTStateLogTest {

    private static final long SECOND = TimeUnit.SECONDS.toMillis(1);
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long NOW = 20_000 * TimeUnit.DAYS.toMillis(1) + 10 * HOUR;
    private static final UUID ALICE = GTTestSupport.uuid("alice");
    private static final UUID BOB = GTTestSupport.uuid("bob");

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
        GTTestSupport.startHistory();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    private static void scan(long at, GTMachineSnapshot... machines) {
        List<GTMachineSnapshot> list = Arrays.asList(machines);
        GTMachineRegistry.apply(list, at);
        GTStateLog.record(list, at);
    }

    @Test
    void eachScanCreditsTheTimeSinceThePreviousOneToTheCurrentStatus() {
        GTMachineSnapshot running = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        GTMachineSnapshot idle = GTTestSupport.machine(1, ALICE, GTMachineStatus.IDLE);
        scan(NOW, running);
        scan(NOW + 10 * SECOND, running);
        scan(NOW + 20 * SECOND, idle);
        // A paused server: only one scan interval is credited, not the whole hour.
        scan(NOW + 20 * SECOND + HOUR / 2, idle);
        GTTestSupport.flushHistory();

        Map<String, Long> states = GTStateLog.totals(NOW - HOUR, NOW + HOUR, owner -> true)
            .get(running.id);
        assertEquals(10 * SECOND, (long) states.get("running"));
        assertEquals(20 * SECOND, (long) states.get("idle"));
    }

    @Test
    void idleTimeIsAlsoSplitByItsReason() {
        GTMachineSnapshot starved = GTTestSupport.machine(1, ALICE, GTMachineStatus.IDLE);
        starved.idleReason = "no_recipe";
        GTMachineSnapshot underVolted = GTTestSupport.machine(1, ALICE, GTMachineStatus.IDLE);
        underVolted.idleReason = "insufficient_voltage";
        scan(NOW, starved);
        scan(NOW + 10 * SECOND, starved);
        scan(NOW + 20 * SECOND, underVolted);
        GTTestSupport.flushHistory();

        Map<String, Long> states = GTStateLog.totals(NOW - HOUR, NOW + HOUR, owner -> true)
            .get(starved.id);
        assertEquals(20 * SECOND, (long) states.get("idle"));
        assertEquals(10 * SECOND, (long) states.get("idle:no_recipe"));
        assertEquals(10 * SECOND, (long) states.get("idle:insufficient_voltage"));
    }

    @Test
    void runningParallelsAreWeightedByTime() {
        GTMachineSnapshot half = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        half.parallels = 8;
        half.maxParallels = 16;
        GTMachineSnapshot full = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        full.parallels = 16;
        full.maxParallels = 16;
        GTMachineSnapshot single = GTTestSupport.machine(2, ALICE, GTMachineStatus.RUNNING);
        single.parallels = 1;
        single.maxParallels = 1;
        scan(NOW, half, single);
        scan(NOW + 10 * SECOND, half, single);
        scan(NOW + 20 * SECOND, full, single);
        GTTestSupport.flushHistory();

        Map<String, Map<String, Long>> totals = GTStateLog.totals(NOW - HOUR, NOW + HOUR, owner -> true);
        Map<String, Long> states = totals.get(half.id);
        assertEquals(240 * SECOND, (long) states.get(GTStateLog.PARALLELS_USED));
        assertEquals(320 * SECOND, (long) states.get(GTStateLog.PARALLELS_MAX));
        assertFalse(
            totals.get(single.id)
                .containsKey(GTStateLog.PARALLELS_MAX),
            "a machine without parallels has no parallel use");
    }

    @Test
    void totalsOnlyCoverVisibleMachines() {
        GTMachineSnapshot alices = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        GTMachineSnapshot bobs = GTTestSupport.machine(2, BOB, GTMachineStatus.RUNNING);
        scan(NOW, alices, bobs);
        scan(NOW + 10 * SECOND, alices, bobs);
        GTTestSupport.flushHistory();

        Map<String, Map<String, Long>> totals = GTStateLog.totals(NOW - HOUR, NOW + HOUR, ALICE::equals);
        assertEquals(1, totals.size());
        assertTrue(totals.containsKey(alices.id));
    }

    @Test
    void outagesAreTheHoursAnyMachineHadNoPower() {
        GTMachineSnapshot fine = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        GTMachineSnapshot dark = GTTestSupport.machine(2, BOB, GTMachineStatus.NO_POWER);
        scan(NOW, fine, dark);
        scan(NOW + 10 * SECOND, fine, dark);
        GTTestSupport.flushHistory();

        BottleneckAnalysis.OutageCheck outages = GTStateLog.outages(NOW - 5 * HOUR, NOW + 5 * HOUR);
        assertTrue(outages.overlaps(NOW - HOUR, NOW + 1));
        assertFalse(outages.overlaps(NOW - 3 * HOUR, NOW - 2 * HOUR));
        assertFalse(outages.overlaps(NOW + HOUR, NOW + 2 * HOUR));
    }
}
