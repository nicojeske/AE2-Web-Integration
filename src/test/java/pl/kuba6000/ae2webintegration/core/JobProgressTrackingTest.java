package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.jetbrains.annotations.NotNull;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.api.DimensionalCoords;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAE;
import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingPatternDetails;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.IPatternProviderViewable;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker.JobTrackingInfo;

@SuppressWarnings("PMD.AvoidMagicNumbers")
class JobProgressTrackingTest extends GridTestScope {

    private static final long MINUTE = 60_000L;

    private final TestGridFixtures.TestGrid grid = TestGridFixtures.grid(900_201L);
    private IAE previousAe;

    @BeforeEach
    void setUp() {
        AE2JobTracker.clearActiveJobs();
        TestGridFixtures.track(grid);
        previousAe = AE2Controller.AE2Interface;
        AE2Controller.AE2Interface = new TestGridFixtures.TestAE(grid) {

            @Override
            public IStackList web$createStackList() {
                return new ListedStacks();
            }
        };
    }

    @AfterEach
    void tearDown() {
        AE2JobTracker.clearActiveJobs();
        AE2Controller.AE2Interface = previousAe;
    }

    @Test
    void plannedTotalsAreFixedAtStartAndRecountedOnMerge() {
        Resource plate = new Resource(1);
        Resource gear = new Resource(2);
        Resource ingot = new Resource(3);
        PlanCpu cpu = new PlanCpu();
        cpu.pending.put(plate, 8L);
        cpu.pending.put(gear, 2L);
        cpu.stored.add(ingot); // held, not crafted - not part of the plan

        AE2JobTracker.addJob(cpu, grid, false);
        JobTrackingInfo info = AE2JobTracker.findActiveJob(cpu);
        assertNotNull(info);
        assertEquals(8L, info.planned.get(plate));
        assertEquals(2L, info.planned.get(gear));
        assertNull(info.planned.get(ingot));
        assertEquals(10L, info.plannedTotal);

        // Four plates come back; the CPU's remaining work shrinks accordingly.
        cpu.pending.put(plate, 0L);
        cpu.waiting.put(plate, 8L);
        update(cpu, plate);
        cpu.waiting.put(plate, 4L);
        update(cpu, plate);
        assertEquals(4L, info.craftedSum);
        assertEquals(10L, info.plannedTotal);

        // A merge adds work on top of what is left; the crafted part stays counted.
        cpu.active.put(plate, 4L);
        cpu.pending.put(gear, 5L);
        AE2JobTracker.addJob(cpu, grid, true);
        assertEquals(8L, info.planned.get(plate));
        assertEquals(5L, info.planned.get(gear));
        assertEquals(13L, info.plannedTotal);
    }

    @Test
    void aJobWithoutProgressStallsUntilSomethingIsDelivered() {
        Resource plate = new Resource(1);
        PlanCpu cpu = new PlanCpu();
        cpu.pending.put(plate, 2L);
        AE2JobTracker.addJob(cpu, grid, false);
        JobTrackingInfo info = AE2JobTracker.findActiveJob(cpu);
        assertNotNull(info);
        long started = info.lastProgressAt;

        AE2JobTracker.checkStalls(started + 14 * MINUTE, 15 * MINUTE);
        assertEquals(0L, info.stalledSince);

        IPatternProviderViewable bender = new IPatternProviderViewable() {

            @Override
            public String web$getName() {
                return "Bender";
            }

            @Override
            public DimensionalCoords web$getLocation() {
                return new DimensionalCoords(0, 1, 2, 3);
            }
        };
        AE2JobTracker.pushedPattern(cpu, bender, pattern(plate));
        AE2JobTracker.checkStalls(started + 15 * MINUTE, 15 * MINUTE);
        assertEquals(started, info.stalledSince);
        assertEquals("Waiting on Bender at 1, 2, 3 for Resource 1.", info.stallReason);

        cpu.waiting.put(plate, 2L);
        update(cpu, plate);
        cpu.waiting.put(plate, 1L);
        update(cpu, plate);
        assertEquals(0L, info.stalledSince);
        assertNull(info.stallReason);
    }

    @Test
    void stallDetectionCanBeTurnedOff() {
        PlanCpu cpu = new PlanCpu();
        AE2JobTracker.addJob(cpu, grid, false);
        JobTrackingInfo info = AE2JobTracker.findActiveJob(cpu);
        assertNotNull(info);

        AE2JobTracker.checkStalls(info.lastProgressAt + 600 * MINUTE, 0L);

        assertEquals(0L, info.stalledSince);
    }

    @Test
    void aWebSubmissionIsAttributedToTheWebUserOverThePlatformsSource() {
        PlanCpu player = new PlanCpu();
        AE2JobTracker.addJob(player, grid, false, "Steve");
        PlanCpu web = new PlanCpu();
        AE2JobTracker.runAsWebRequester("Alex", () -> AE2JobTracker.addJob(web, grid, false, "[AE2WebIntegration]"));
        PlanCpu machine = new PlanCpu();
        AE2JobTracker.addJob(machine, grid, false, null);

        assertEquals("Steve", AE2JobTracker.findActiveJob(player).requestedBy);
        assertEquals("Alex", AE2JobTracker.findActiveJob(web).requestedBy);
        assertNull(AE2JobTracker.findActiveJob(machine).requestedBy);
    }

    private static void update(PlanCpu cpu, Resource resource) {
        AE2JobTracker.updateCraftingStatus(cpu, resource);
    }

    private static IAECraftingPatternDetails pattern(Resource output) {
        return new IAECraftingPatternDetails() {

            @Override
            public IAEGenericStack[] web$getCondensedOutputs() {
                return new IAEGenericStack[] { stack(output, 1) };
            }

            @Override
            public IAEGenericStack[] web$getCondensedInputs() {
                return new IAEGenericStack[0];
            }
        };
    }

    private static IAEGenericStack stack(IAEKey key, long amount) {
        return new IAEGenericStack() {

            @Override
            public @NotNull IAEKey web$what() {
                return key;
            }

            @Override
            public long web$amount() {
                return amount;
            }
        };
    }

    /** The native stack list a CPU fills in {@code web$getAllItems}. */
    private static final class ListedStacks implements IStackList {

        private final List<IAEGenericStack> stacks = new ArrayList<>();

        @Override
        public long web$getAmount(IAEKey key) {
            return 0L;
        }

        @Override
        public Iterable<IAEGenericStack> web$stacks() {
            return stacks;
        }
    }

    @Desugar
    private record Resource(int id) implements IAEKey {

        @Override
        public @NotNull StableKey web$getKey() {
            throw new AssertionError("Tracking must not encode stable resource IDs");
        }

        @Override
        public @NotNull IAEKey web$copyIdentity() {
            return this;
        }

        @Override
        public @NotNull String web$getItemID() {
            return "test:resource_" + id;
        }

        @Override
        public @NotNull String web$getDisplayName() {
            return "Resource " + id;
        }

        @Override
        public boolean web$isCraftable(IAEGrid grid) {
            return true;
        }
    }

    /** A CPU whose remaining work (active/pending) and held stacks are set by the test. */
    private static final class PlanCpu implements ICraftingCPUCluster {

        private final HashMap<IAEKey, Long> active = new HashMap<>();
        private final HashMap<IAEKey, Long> pending = new HashMap<>();
        private final List<IAEKey> stored = new ArrayList<>();
        private final HashMap<IAEKey, Long> waiting = new HashMap<>();

        @Override
        public @NotNull StableKey web$getKey() {
            return StableKey.parse("AAAAAAAAAAAAAAAAAAAAAA");
        }

        @Override
        public String web$getName() {
            return "cpu";
        }

        @Override
        public long web$getAvailableStorage() {
            return 0;
        }

        @Override
        public long web$getUsedStorage() {
            return 0;
        }

        @Override
        public long web$getCoProcessors() {
            return 0;
        }

        @Override
        public boolean web$isBusy() {
            return true;
        }

        @Override
        public void web$cancel() {}

        @Override
        public IAEGenericStack web$getFinalOutput() {
            return new OutputSnapshotTest.Stack(new OutputSnapshotTest.Resource(), 5);
        }

        @Override
        public long web$getActiveItems(IAEKey key) {
            return active.getOrDefault(key, 0L);
        }

        @Override
        public long web$getPendingItems(IAEKey key) {
            return pending.getOrDefault(key, 0L);
        }

        @Override
        public long web$getStorageItems(IAEKey key) {
            return stored.contains(key) ? 1L : 0L;
        }

        @Override
        public void web$getAllItems(IStackList list) {
            // Like a native list: one stack per resource.
            Set<IAEKey> keys = new LinkedHashSet<>(active.keySet());
            keys.addAll(pending.keySet());
            keys.addAll(stored);
            for (IAEKey key : keys) ((ListedStacks) list).stacks.add(stack(key, 1));
        }

        @Override
        public IStackList web$getWaitingFor() {
            return new IStackList() {

                @Override
                public long web$getAmount(IAEKey key) {
                    return waiting.getOrDefault(key, 0L);
                }

                @Override
                public Iterable<IAEGenericStack> web$stacks() {
                    return new ArrayList<>();
                }
            };
        }
    }
}
