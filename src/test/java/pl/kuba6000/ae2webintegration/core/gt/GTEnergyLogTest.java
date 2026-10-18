package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

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

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;

class GTEnergyLogTest {

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

    private static void scan(long at, long ticks, GTMachineSnapshot... machines) {
        List<GTMachineSnapshot> list = Arrays.asList(machines);
        GTMachineRegistry.apply(list, at);
        GTEnergyLog.record(list, at, ticks);
    }

    private static GTMachineSnapshot machine(int n, UUID owner, GTMachineStatus status, long euPerTick) {
        GTMachineSnapshot machine = GTTestSupport.machine(n, owner, status);
        machine.euPerTick = euPerTick;
        return machine;
    }

    @Test
    void runningMachinesAreCreditedTheirRateTimesTheTicksSinceTheLastScan() {
        GTMachineSnapshot ebf = machine(1, ALICE, GTMachineStatus.RUNNING, 1920);
        GTMachineSnapshot turbine = machine(2, ALICE, GTMachineStatus.RUNNING, -8192);
        GTMachineSnapshot idle = machine(3, ALICE, GTMachineStatus.IDLE, 1920);
        scan(NOW, 1000, ebf, turbine, idle);
        // A laggy 10 s: only 100 ticks went by, and that is what counts.
        scan(NOW + 10 * SECOND, 1100, ebf, turbine, idle);
        scan(NOW + 20 * SECOND, 1300, ebf, turbine, idle);
        GTTestSupport.flushHistory();

        Map<String, long[]> totals = GTEnergyLog.totals(NOW - HOUR, NOW + HOUR, owner -> true);
        assertArrayEquals(new long[] { 1920 * 300, 0 }, totals.get(ebf.id));
        assertArrayEquals(new long[] { 0, 8192 * 300 }, totals.get(turbine.id));
        assertFalse(totals.containsKey(idle.id));
    }

    @Test
    void aStalledServerIsCreditedOneScanAndOnlyVisibleMachinesAreRead() {
        GTMachineSnapshot alices = machine(1, ALICE, GTMachineStatus.RUNNING, 30);
        GTMachineSnapshot bobs = machine(2, BOB, GTMachineStatus.RUNNING, 30);
        scan(NOW, 0, alices, bobs);
        scan(NOW + HOUR / 2, 36_000, alices, bobs);
        GTTestSupport.flushHistory();

        Map<String, long[]> totals = GTEnergyLog.totals(NOW - HOUR, NOW + HOUR, ALICE::equals);
        assertEquals(1, totals.size());
        long scanTicks = Config.INSTANCE.gregtech.scanIntervalSeconds * 20L;
        assertEquals(30 * scanTicks, totals.get(alices.id)[0]);
    }
}
