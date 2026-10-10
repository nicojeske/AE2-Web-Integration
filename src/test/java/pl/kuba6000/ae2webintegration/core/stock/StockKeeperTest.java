package pl.kuba6000.ae2webintegration.core.stock;

import static org.junit.jupiter.api.Assertions.*;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.function.Function;

import org.jetbrains.annotations.NotNull;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.api.AEApi.AEControllerState;
import pl.kuba6000.ae2webintegration.core.api.DimensionalCoords;
import pl.kuba6000.ae2webintegration.core.api.PlayerIdentity;
import pl.kuba6000.ae2webintegration.core.config.ConfigTestFixture;
import pl.kuba6000.ae2webintegration.core.grid.GridAccessSource;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.grid.StockRule;
import pl.kuba6000.ae2webintegration.core.grid.StockRulesData;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingJob;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEMeInventoryItem;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingPlanSummary;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAECraftingGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAEPathingGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAEStorageGrid;
import pl.kuba6000.ae2webintegration.core.notification.message.IMessage;
import pl.kuba6000.ae2webintegration.core.notification.message.StatusMessage;

@SuppressWarnings("PMD.AvoidMagicNumbers")
class StockKeeperTest {

    private static final String IRON = "minecraft:iron_ingot:0";
    private static final String GOLD = "minecraft:gold_ingot:0";
    private static final long NOW = 1_760_000_000_000L;

    @TempDir
    File save;

    private ConfigTestFixture config;
    private final List<IMessage> sent = new ArrayList<>();
    private FakeGrid grid;
    private StableKey key;

    @BeforeEach
    void setUp() throws IOException {
        config = new ConfigTestFixture();
        config.set("general.public_mode", false);
        StockKeeper.notifier = sent::add;
        CoreEngine.GRID_IDENTITIES.initialize(save);
        grid = new FakeGrid();
        CoreEngine.GRID_IDENTITIES.controllerValidated(grid);
        key = CoreEngine.GRID_IDENTITIES.getKey(grid);
        assertNotNull(key);
    }

    @AfterEach
    void tearDown() {
        StockKeeper.clear();
        StockKeeper.notifier = pl.kuba6000.ae2webintegration.core.notification.NotificationManager::postMessageNonBlocking;
        CoreEngine.GRID_IDENTITIES.clear();
        config.close();
    }

    @Test
    void alertsOncePerDipAndAgainAfterRecovering() {
        rule(IRON, new StockRule(100, 0, 1, false));
        grid.stored.put(IRON, 37L);

        StockKeeper.check(key, grid, NOW);
        StockKeeper.check(key, grid, NOW + 1);
        assertEquals(1, sent.size());
        StatusMessage message = (StatusMessage) sent.get(0);
        assertEquals("Low stock: " + IRON, message.title());
        assertEquals(StatusMessage.Severity.WARNING, message.severity());
        assertTrue(
            StockKeeper.status(key)
                .get(IRON)
                .low());

        grid.stored.put(IRON, 100L);
        StockKeeper.check(key, grid, NOW + 2);
        assertFalse(
            StockKeeper.status(key)
                .get(IRON)
                .low());
        grid.stored.put(IRON, 5L);
        StockKeeper.check(key, grid, NOW + 3);
        assertEquals(2, sent.size());
    }

    @Test
    void anItemMissingFromStorageCountsAsZero() {
        rule(GOLD, new StockRule(1, 0, 1, false));
        StockKeeper.check(key, grid, NOW);
        assertEquals(
            0L,
            StockKeeper.status(key)
                .get(GOLD)
                .stored());
        assertEquals(1, sent.size());
    }

    @Test
    void theAlertFlagSurvivesARestart() throws IOException {
        rule(IRON, new StockRule(100, 0, 1, false));
        grid.stored.put(IRON, 1L);
        StockKeeper.check(key, grid, NOW);
        assertEquals(1, sent.size());

        StockKeeper.clear();
        CoreEngine.GRID_IDENTITIES.initialize(save);
        CoreEngine.GRID_IDENTITIES.controllerValidated(grid);
        assertEquals(key, CoreEngine.GRID_IDENTITIES.getKey(grid));
        StockKeeper.check(key, grid, NOW + 1);
        assertEquals(1, sent.size());
    }

    @Test
    void publicModeNeverAlerts() {
        config.set("general.public_mode", true);
        rule(IRON, new StockRule(100, 0, 1, false));
        StockKeeper.check(key, grid, NOW);
        assertTrue(sent.isEmpty());
        assertTrue(
            StockKeeper.status(key)
                .get(IRON)
                .low());
    }

    @Test
    void autoCraftPlansTheGapClampedToTheBatchAndSubmitsOnTheNextCheck() {
        rule(IRON, new StockRule(0, 200, 64, true));
        grid.stored.put(IRON, 50L);
        grid.craftable.add(IRON);

        StockKeeper.check(key, grid, NOW);
        assertEquals(Collections.singletonList(64L), grid.crafting.planned);
        assertTrue(
            StockKeeper.status(key)
                .get(IRON)
                .crafting());
        assertEquals(
            NOW,
            StockKeeper.status(key)
                .get(IRON)
                .lastAttempt());

        StockKeeper.check(key, grid, NOW + 1);
        assertEquals(1, grid.crafting.submitted);
        assertNull(
            StockKeeper.status(key)
                .get(IRON)
                .lastError());

        // The plan the gap needed is now running on a CPU: no second order for the same item.
        grid.crafting.cpus.add(new FakeCpu(IRON));
        StockKeeper.check(key, grid, NOW + 2);
        assertEquals(1, grid.crafting.planned.size());
        assertTrue(
            StockKeeper.status(key)
                .get(IRON)
                .crafting());
    }

    @Test
    void aSmallGapOrdersOnlyTheGap() {
        rule(IRON, new StockRule(0, 200, 64, true));
        grid.stored.put(IRON, 190L);
        grid.craftable.add(IRON);
        StockKeeper.check(key, grid, NOW);
        assertEquals(Collections.singletonList(10L), grid.crafting.planned);
    }

    @Test
    void aSimulatedPlanBacksOff() {
        rule(IRON, new StockRule(0, 200, 64, true));
        grid.craftable.add(IRON);
        grid.crafting.simulation = true;

        StockKeeper.check(key, grid, NOW);
        StockKeeper.check(key, grid, NOW + 1);
        assertEquals(0, grid.crafting.submitted);
        StockKeeper.RuleStatus status = StockKeeper.status(key)
            .get(IRON);
        assertEquals("Missing ingredients", status.lastError());
        assertEquals(NOW + 1 + StockKeeper.BACKOFF_MILLIS, status.backoffUntil());

        StockKeeper.check(key, grid, NOW + 2);
        assertEquals(1, grid.crafting.planned.size());
        StockKeeper.check(key, grid, NOW + 1 + StockKeeper.BACKOFF_MILLIS);
        assertEquals(2, grid.crafting.planned.size());
    }

    @Test
    void aSubmitErrorBacksOff() {
        rule(IRON, new StockRule(0, 200, 64, true));
        grid.craftable.add(IRON);
        grid.crafting.submitError = "No CPU available";
        StockKeeper.check(key, grid, NOW);
        StockKeeper.check(key, grid, NOW + 1);
        assertEquals(
            "No CPU available",
            StockKeeper.status(key)
                .get(IRON)
                .lastError());
        assertTrue(
            StockKeeper.status(key)
                .get(IRON)
                .backoffUntil() > NOW);
    }

    @Test
    void aPlanStillComputingIsAbandonedAfterTheTimeout() {
        rule(IRON, new StockRule(0, 200, 64, true));
        grid.craftable.add(IRON);
        grid.crafting.finishPlans = false;
        StockKeeper.check(key, grid, NOW);
        StockKeeper.check(key, grid, NOW + StockKeeper.PLAN_TIMEOUT_MILLIS - 1);
        assertNull(
            StockKeeper.status(key)
                .get(IRON)
                .lastError());
        StockKeeper.check(key, grid, NOW + StockKeeper.PLAN_TIMEOUT_MILLIS);
        assertEquals(
            "Plan took too long to compute",
            StockKeeper.status(key)
                .get(IRON)
                .lastError());
        assertTrue(grid.crafting.lastPlan.isCancelled());
    }

    @Test
    void onePlanAtATimePerGrid() {
        rule(IRON, new StockRule(0, 200, 64, true));
        rule(GOLD, new StockRule(0, 200, 64, true));
        grid.craftable.add(IRON);
        grid.craftable.add(GOLD);
        grid.crafting.finishPlans = false;
        StockKeeper.check(key, grid, NOW);
        assertEquals(1, grid.crafting.planned.size());
        assertFalse(
            StockKeeper.status(key)
                .get(GOLD)
                .crafting());
    }

    @Test
    void anItemWithoutAPatternReportsItWithoutPlanning() {
        rule(IRON, new StockRule(0, 200, 64, true));
        StockKeeper.check(key, grid, NOW);
        assertTrue(grid.crafting.planned.isEmpty());
        assertEquals(
            "No crafting pattern",
            StockKeeper.status(key)
                .get(IRON)
                .lastError());
        assertEquals(
            0L,
            StockKeeper.status(key)
                .get(IRON)
                .backoffUntil());
    }

    @Test
    void deletingARuleAbandonsItsPlanAndStatus() {
        rule(IRON, new StockRule(0, 200, 64, true));
        rule(GOLD, new StockRule(0, 0, 1, false));
        grid.craftable.add(IRON);
        grid.crafting.finishPlans = false;
        StockKeeper.check(key, grid, NOW);
        rules().remove(IRON);
        StockKeeper.check(key, grid, NOW + 1);
        assertTrue(grid.crafting.lastPlan.isCancelled());
        assertNull(
            StockKeeper.status(key)
                .get(IRON));
    }

    @Test
    void rulesAreCappedAndValidated() {
        StockRulesData rules = rules();
        for (int i = 0; i < StockRulesData.MAX_RULES; i++)
            assertTrue(rules.put("item:" + i, new StockRule(1, 1, 1, false)));
        assertFalse(rules.put("one:more", new StockRule(1, 1, 1, false)));
        assertTrue(rules.put("item:0", new StockRule(2, 2, 2, true)));
        assertFalse(new StockRule(1, 1, 0, false).isValid());
        assertFalse(new StockRule(-1, 1, 1, false).isValid());
        assertFalse(StockRulesData.isValidItemId(""));
    }

    @Test
    void rulesPersistAndAGridWithRulesKeepsItsIdentity() throws IOException {
        rule(IRON, new StockRule(100, 200, 64, true));
        GridIdentityRegistry restarted = new GridIdentityRegistry(
            new File(save, "ae2webintegration/grid-identities.json"));
        GridPersistentData data = restarted.getPersistentData(key);
        assertNotNull(data);
        assertEquals(
            new StockRule(100, 200, 64, true),
            data.getStockRules()
                .rules()
                .get(IRON));
        assertFalse(data.isDefault());
    }

    private StockRulesData rules() {
        GridPersistentData data = CoreEngine.GRID_IDENTITIES.getPersistentData(key);
        assertNotNull(data);
        return data.getStockRules();
    }

    private void rule(String itemid, StockRule rule) {
        synchronized (CoreEngine.GRID_IDENTITIES) {
            assertTrue(rules().put(itemid, rule));
            try {
                CoreEngine.GRID_IDENTITIES.saveIfDirty();
            } catch (IOException e) {
                throw new AssertionError(e);
            }
        }
    }

    private static final class FakeKey implements IAEKey {

        private final String itemid;

        FakeKey(String itemid) {
            this.itemid = itemid;
        }

        @Override
        public @NotNull StableKey web$getKey() {
            return StableKey.create(sink -> StableKey.writeText(sink, itemid));
        }

        @Override
        public @NotNull IAEKey web$copyIdentity() {
            return this;
        }

        @Override
        public @NotNull String web$getItemID() {
            return itemid;
        }

        @Override
        public @NotNull String web$getDisplayName() {
            return itemid;
        }

        @Override
        public boolean web$isCraftable(IAEGrid grid) {
            return false;
        }
    }

    private static IAEGenericStack stack(String itemid, long amount) {
        IAEKey key = new FakeKey(itemid);
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

    private static final class FakeCpu implements ICraftingCPUCluster {

        private final String output;

        FakeCpu(String output) {
            this.output = output;
        }

        @Override
        public @NotNull StableKey web$getKey() {
            return StableKey.create(sink -> StableKey.writeText(sink, "cpu"));
        }

        @Override
        public String web$getName() {
            return "CPU";
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
            return stack(output, 1);
        }

        @Override
        public long web$getActiveItems(IAEKey key) {
            return 0;
        }

        @Override
        public long web$getPendingItems(IAEKey key) {
            return 0;
        }

        @Override
        public long web$getStorageItems(IAEKey key) {
            return 0;
        }

        @Override
        public void web$getAllItems(IStackList list) {}

        @Override
        public IStackList web$getWaitingFor() {
            return null;
        }
    }

    private static final class FakeCrafting implements IAECraftingGrid {

        private final FakeGrid grid;
        final List<Long> planned = new ArrayList<>();
        final Set<ICraftingCPUCluster> cpus = new HashSet<>();
        int submitted;
        boolean simulation;
        boolean finishPlans = true;
        String submitError;
        CompletableFuture<IAECraftingJob> lastPlan;

        FakeCrafting(FakeGrid grid) {
            this.grid = grid;
        }

        @Override
        public boolean web$isCurrentlyCraftable(IAEKey key) {
            return grid.craftable.contains(key.web$getItemID());
        }

        @Override
        public int web$getCPUCount() {
            return cpus.size();
        }

        @Override
        public Set<ICraftingCPUCluster> web$getCPUs() {
            return cpus;
        }

        @Override
        public Future<IAECraftingJob> web$beginCraftingJob(IAEGrid grid, IAEKey key, long amount) {
            planned.add(amount);
            lastPlan = new CompletableFuture<>();
            if (finishPlans) lastPlan.complete(new IAECraftingJob() {

                @Override
                public boolean web$isSimulation() {
                    return simulation;
                }

                @Override
                public long web$getByteTotal() {
                    return 0;
                }

                @Override
                public ICraftingPlanSummary web$generateSummary(IAEGrid grid) {
                    return null;
                }
            });
            return lastPlan;
        }

        @Override
        public String web$submitJob(IAECraftingJob job, ICraftingCPUCluster target, boolean prioritizePower,
            IAEGrid grid) {
            if (submitError != null) return submitError;
            submitted++;
            return null;
        }

        @Override
        public Set<IAEKey> web$getCraftables(Function<IAEKey, Boolean> filter) {
            Set<IAEKey> out = new HashSet<>();
            for (String itemid : grid.craftable) {
                IAEKey key = new FakeKey(itemid);
                if (filter == null || filter.apply(key)) out.add(key);
            }
            return out;
        }
    }

    private static final class FakeGrid implements IAEGrid, IAEPathingGrid, IAEStorageGrid, IStackList {

        final Map<String, Long> stored = new LinkedHashMap<>();
        final Set<String> craftable = new HashSet<>();
        final FakeCrafting crafting = new FakeCrafting(this);
        private final PlayerIdentity owner = new PlayerIdentity(UUID.nameUUIDFromBytes(new byte[] { 1 }), "Owner");

        @Override
        public @NotNull Set<DimensionalCoords> web$getControllers() {
            return Collections.singleton(new DimensionalCoords("world", 1, 2, 3));
        }

        @Override
        public @NotNull Map<UUID, List<GridAccessSource>> web$getPermissions() {
            return new HashMap<>();
        }

        @Override
        public boolean web$hasAccess(@NotNull UUID playerId) {
            return false;
        }

        @Override
        public PlayerIdentity web$getRepresentativeOwner() {
            return owner;
        }

        @Override
        public IAECraftingGrid web$getCraftingGrid() {
            return crafting;
        }

        @Override
        public IAEPathingGrid web$getPathingGrid() {
            return this;
        }

        @Override
        public IAEStorageGrid web$getStorageGrid() {
            return this;
        }

        @Override
        public boolean web$isNetworkBooting() {
            return false;
        }

        @Override
        public AEControllerState web$getControllerState() {
            return AEControllerState.CONTROLLER_ONLINE;
        }

        @Override
        public IStackList web$getStorageList() {
            return this;
        }

        @Override
        public IAEMeInventoryItem web$getInventory() {
            return null;
        }

        @Override
        public long web$getAmount(IAEKey key) {
            return stored.getOrDefault(key.web$getItemID(), 0L);
        }

        @Override
        public Iterable<IAEGenericStack> web$stacks() {
            List<IAEGenericStack> stacks = new ArrayList<>();
            stored.forEach((itemid, amount) -> stacks.add(stack(itemid, amount)));
            return stacks;
        }
    }
}
