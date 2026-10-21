package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;

class GTLabelStoreTest {

    private static final UUID ALICE = GTTestSupport.uuid("alice");
    private static final UUID CAROL = GTTestSupport.uuid("carol");
    private static final Predicate<UUID> EVERYONE = owner -> true;

    @TempDir
    File configRoot;

    private GTTestSupport.FakeProvider provider;
    private String alices;
    private String carols;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
        provider = new GTTestSupport.FakeProvider();
        GTMachineSnapshot a = GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING);
        GTMachineSnapshot c = GTTestSupport.machine(2, CAROL, GTMachineStatus.RUNNING);
        provider.next.machines.add(a);
        provider.next.machines.add(c);
        provider.next.energyTunnels.add(GTTestSupport.tunnel(3, ALICE, "Main line", 0, 0, 0, 8192));
        GTTestSupport.scan(provider, System.currentTimeMillis());
        alices = a.id;
        carols = c.id;
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    @Test
    void blankClearsAndAnEmptyRecordIsDropped() {
        GTLabelStore.setNickname(alices, "  EBF #2  ");
        GTLabelStore.setLine(alices, "Platline");
        assertEquals("EBF #2", GTLabelStore.of(alices).nickname);
        assertEquals("Platline", GTLabelStore.lineOf(alices));

        GTLabelStore.setNickname(alices, " ");
        assertNull(GTLabelStore.of(alices).nickname);
        assertEquals("Platline", GTLabelStore.lineOf(alices));
        GTLabelStore.setLine(alices, null);
        assertNull(GTLabelStore.of(alices));
    }

    @Test
    void labelsAreCappedAt64Characters() {
        GTLabelStore.setLine(alices, String.join("", Collections.nCopies(100, "x")));
        assertEquals(
            GTLabelStore.MAX_LABEL_LENGTH,
            GTLabelStore.lineOf(alices)
                .length());
    }

    @Test
    void renameMovesOnlyVisibleMembersAndMerges() {
        GTLabelStore.setLine(alices, "Plat");
        GTLabelStore.setLine(carols, "Plat");
        assertEquals(1, GTLabelStore.renameLine("Plat", "Platinum", ALICE::equals));
        assertEquals("Platinum", GTLabelStore.lineOf(alices));
        assertEquals("Plat", GTLabelStore.lineOf(carols));

        assertEquals(1, GTLabelStore.renameLine("Plat", "Platinum", EVERYONE));
        assertEquals(
            2,
            GTLabelStore.membersOf("Platinum", EVERYONE)
                .size());
        assertEquals(Collections.singletonList(alices), GTLabelStore.membersOf("Platinum", ALICE::equals));
        assertEquals(0, GTLabelStore.renameLine("Missing", "x", EVERYONE));
    }

    @Test
    void snapshotFiltersByOwnerAndUnknownOwnersPassNoPlayer() {
        String tunnel = provider.next.energyTunnels.get(0).id;
        GTLabelStore.setNickname(alices, "Mine");
        GTLabelStore.setNickname(carols, "Hers");
        GTLabelStore.setNickname("never-scanned", "Ghost");
        GTLabelStore.setCapacity(tunnel, 64, 5);

        GTLabelStore.Snapshot alice = GTLabelStore.snapshot(owner -> ALICE.equals(owner));
        assertEquals(Collections.singleton(alices), alice.machines.keySet());
        assertEquals(64, alice.tunnels.get(tunnel).amps);
        assertTrue(GTLabelStore.snapshot(owner -> CAROL.equals(owner)).tunnels.isEmpty());
        assertTrue(GTLabelStore.snapshot(EVERYONE).machines.containsKey("never-scanned"));
        assertFalse(GTLabelStore.machineVisible("never-scanned", EVERYONE));
    }

    @Test
    void capacityValidation() {
        assertTrue(GTLabelStore.TunnelCapacity.isValid(1, 0));
        assertTrue(GTLabelStore.TunnelCapacity.isValid(GTLabelStore.MAX_AMPS, GTLabelStore.MAX_TIER));
        assertFalse(GTLabelStore.TunnelCapacity.isValid(0, 5));
        assertFalse(GTLabelStore.TunnelCapacity.isValid(64, -1));
        assertFalse(GTLabelStore.TunnelCapacity.isValid(64, GTLabelStore.MAX_TIER + 1));
    }

    @Test
    void survivesASaveAndLoad() {
        String tunnel = provider.next.energyTunnels.get(0).id;
        GTLabelStore.setNickname(alices, "EBF #2");
        GTLabelStore.setLine(alices, "Platline");
        GTLabelStore.setCapacity(tunnel, 64, 5);
        GTLabelStore.saveNow();
        GTLabelStore.clear();
        assertNull(GTLabelStore.of(alices));

        GTLabelStore.loadData();
        assertEquals("EBF #2", GTLabelStore.of(alices).nickname);
        assertEquals("Platline", GTLabelStore.lineOf(alices));
        assertEquals(5, GTLabelStore.capacityOf(tunnel).tier);
    }

    @Test
    void removedAndForgottenMachinesLoseTheirLabels() {
        GTLabelStore.setLine(alices, "Platline");
        GTLabelStore.setLine(carols, "Platline");
        GTMachineRegistry.remove(alices);
        assertNull(GTLabelStore.of(alices));

        // Carol's machine drops out of the scans and ages past gt_machine_forget_days.
        provider.next.machines.clear();
        GTTestSupport.scan(provider, System.currentTimeMillis() + TimeUnit.DAYS.toMillis(8));
        assertNull(GTLabelStore.of(carols));
    }
}
