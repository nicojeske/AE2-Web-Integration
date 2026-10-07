package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;

class GTEngineTest {

    private static final long NOW = 1_700_000_000_000L;
    private static final long SECOND_NANOS = TimeUnit.SECONDS.toNanos(1);
    private static final UUID ALICE = GTTestSupport.uuid("alice");

    @TempDir
    File configRoot;

    private GTTestSupport.FakeProvider provider;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
        provider = new GTTestSupport.FakeProvider();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    @Test
    void unavailableWithoutProviderOrWhenDisabled() {
        assertFalse(GTEngine.isAvailable());
        GTEngine.onServerTick(0, NOW);
        assertEquals(0, provider.scans);

        GTEngine.registerProvider(provider);
        assertTrue(GTEngine.isAvailable());

        Config.INSTANCE.gregtech.enabled = false;
        assertFalse(GTEngine.isAvailable());
        GTEngine.onServerTick(0, NOW);
        assertEquals(0, provider.scans, "disabled means no scans either");
    }

    @Test
    void scansOnceThenWaitsForTheInterval() {
        GTEngine.registerProvider(provider);
        long t = 1_000 * SECOND_NANOS;

        GTEngine.onServerTick(t, NOW);
        GTEngine.onServerTick(t + 9 * SECOND_NANOS, NOW);
        assertEquals(1, provider.scans);

        GTEngine.onServerTick(t + 10 * SECOND_NANOS, NOW);
        assertEquals(2, provider.scans);
    }

    @Test
    void aThrowingScanIsContainedAndBacksOff() {
        GTEngine.registerProvider(provider);
        provider.fail = true;
        long t = 1_000 * SECOND_NANOS;

        GTEngine.onServerTick(t, NOW);
        GTEngine.onServerTick(t + 30 * SECOND_NANOS, NOW);
        assertEquals(1, provider.scans, "no retry inside the backoff");

        GTEngine.onServerTick(t + 61 * SECOND_NANOS, NOW);
        assertEquals(2, provider.scans);
    }

    @Test
    void scanResultsLandInRegistryWithLoadedAndLastSeen() {
        provider.next.machines.add(GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING));

        GTTestSupport.scan(provider, NOW);

        GTMachineSnapshot stored = GTMachineRegistry.get(GTMachineSnapshot.idOf(0, 1, 64, 0));
        assertNotNull(stored);
        assertTrue(stored.loaded);
        assertEquals(NOW, stored.lastSeenMillis);
        assertEquals(NOW, GTEngine.lastScanMillis());
    }

    @Test
    void machinesMissingFromAScanAreKeptAsUnloadedThenForgotten() {
        provider.next.machines.add(GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING));
        GTTestSupport.scan(provider, NOW);
        String id = GTMachineSnapshot.idOf(0, 1, 64, 0);

        provider.next.machines.clear();
        GTTestSupport.scan(provider, NOW + 1000);
        GTMachineSnapshot unloaded = GTMachineRegistry.get(id);
        assertFalse(unloaded.loaded);
        assertEquals(NOW, unloaded.lastSeenMillis, "last seen is the last scan that saw it");
        assertEquals(GTMachineStatus.RUNNING, unloaded.status, "last known state is kept");

        GTTestSupport.scan(provider, NOW + TimeUnit.DAYS.toMillis(8));
        assertNull(GTMachineRegistry.get(id));
    }

    @Test
    void removedMachinesDisappearImmediately() {
        provider.next.machines.add(GTTestSupport.machine(1, ALICE, GTMachineStatus.IDLE));
        GTTestSupport.scan(provider, NOW);

        GTMachineRegistry.remove(GTMachineSnapshot.idOf(0, 1, 64, 0));

        assertNull(GTMachineRegistry.get(GTMachineSnapshot.idOf(0, 1, 64, 0)));
    }

    @Test
    void registryPersistsAndReloadsAsUnloaded() {
        provider.next.machines.add(GTTestSupport.machine(1, ALICE, GTMachineStatus.MAINTENANCE));
        GTTestSupport.scan(provider, NOW);
        GTEngine.onServerStopping();
        GTMachineRegistry.clear();

        GTMachineRegistry.loadData();

        GTMachineSnapshot loaded = GTMachineRegistry.get(GTMachineSnapshot.idOf(0, 1, 64, 0));
        assertNotNull(loaded);
        assertFalse(loaded.loaded);
        assertEquals(GTMachineStatus.MAINTENANCE, loaded.status);
        assertEquals(ALICE, loaded.owner);
    }

    @Test
    void powerSamplesFollowTheirOwnInterval() {
        GTEngine.registerProvider(provider);
        provider.next.powerSources.add(GTTestSupport.lsc(1, ALICE, 10, 100, 1L, 1L));
        long t = 1_000 * SECOND_NANOS;
        String id = provider.next.powerSources.get(0).id;

        GTEngine.onServerTick(t, NOW);
        provider.next.powerSources.set(0, GTTestSupport.lsc(1, ALICE, 20, 100, 1L, 1L));
        GTEngine.onServerTick(t + 10 * SECOND_NANOS, NOW + 10_000);

        assertEquals(20, GTPowerHistoryStore.latest(id).stored.longValue(), "latest follows every scan");
        GTPowerHistoryStore.Series series = GTPowerHistoryStore.read(id, NOW, NOW + 10_000, 10);
        assertEquals(10, series.stored[0], "but history only got the first, 30 s sample");
    }

    @Test
    void teamsAreMergedNotReplaced() {
        UUID bob = GTTestSupport.uuid("bob");
        provider.next.teams.put(bob, ALICE);
        GTTestSupport.scan(provider, NOW);
        provider.next.teams = Collections.emptyMap();
        GTTestSupport.scan(provider, NOW + 1);

        assertEquals(ALICE, GTVisibility.teamOf(bob));
    }
}
