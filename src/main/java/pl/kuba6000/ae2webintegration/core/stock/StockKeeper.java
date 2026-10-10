package pl.kuba6000.ae2webintegration.core.stock;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.AE2Controller;
import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.grid.GridFilter;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.grid.StockRule;
import pl.kuba6000.ae2webintegration.core.grid.StockRulesData;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingJob;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAECraftingGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAEStorageGrid;
import pl.kuba6000.ae2webintegration.core.notification.NotificationManager;
import pl.kuba6000.ae2webintegration.core.notification.message.IMessage;
import pl.kuba6000.ae2webintegration.core.notification.message.StatusMessage;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker;

/**
 * Checks every grid's {@link StockRulesData} on the server thread: posts one low-stock notification per dip
 * below {@code alertBelow}, and auto-crafts items below {@code keepStock}. Works with no browser open, which
 * is the point - the web terminal only edits the rules and shows {@link #status}.
 * <p>
 * A pass checks one grid per tick (one storage walk each, the cost of a {@code /items} request), like
 * {@code CoreEngine}'s history sampling. Each grid has at most one plan computing at a time; a plan is
 * started on one pass and submitted on a later one, once AE2's planner thread has finished it.
 */
public final class StockKeeper {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    /** Shown as the requester of an auto-craft, in Active Jobs and Crafting History. */
    public static final String REQUESTER = "Auto-stock";
    /** No new attempt at an item for this long after one failed (missing inputs, no free CPU, ...). */
    static final long BACKOFF_MILLIS = TimeUnit.MINUTES.toMillis(5);
    /** A plan still computing after this long is abandoned and counts as a failure. */
    static final long PLAN_TIMEOUT_MILLIS = TimeUnit.MINUTES.toMillis(2);

    /**
     * Runtime state of one rule, as the web terminal shows it.
     *
     * @param itemid       the item the rule is for
     * @param stored       stored amount at the last check, or -1 before the first check
     * @param low          whether the stored amount is below {@code alertBelow} (and alerted)
     * @param crafting     whether a CPU is crafting the item, or an auto-craft plan for it is computing
     * @param lastAttempt  epoch millis of the last auto-craft attempt, 0 if none
     * @param lastError    why the last auto-craft attempt failed, null after a success
     * @param backoffUntil epoch millis before which no new attempt starts, 0 if none
     * @example itemid minecraft:iron_ingot:0
     * @example stored 37
     * @example low true
     * @example crafting false
     * @example lastAttempt 1760000000000
     * @example lastError Missing ingredients
     * @example backoffUntil 1760000300000
     */
    @Desugar
    public record RuleStatus(@NotNull String itemid, long stored, boolean low, boolean crafting, long lastAttempt,
        @Nullable String lastError, long backoffUntil) {}

    /** Server-thread-only per-grid state. */
    private static final class GridState {

        final Map<String, Long> lastAttempt = new HashMap<>();
        final Map<String, String> lastError = new HashMap<>();
        final Map<String, Long> backoffUntil = new HashMap<>();
        @Nullable
        PendingPlan pending;
    }

    private static final class PendingPlan {

        final String itemid;
        final Future<IAECraftingJob> plan;
        final long startedAt;

        PendingPlan(String itemid, Future<IAECraftingJob> plan, long startedAt) {
            this.itemid = itemid;
            this.plan = plan;
            this.startedAt = startedAt;
        }
    }

    private static final Map<StableKey, GridState> STATES = new HashMap<>();
    /** Written on the server thread, read by HTTP workers. */
    private static final Map<StableKey, Map<String, RuleStatus>> STATUS = new ConcurrentHashMap<>();

    /** Replaced by tests, which can't observe the notification thread. */
    static Consumer<IMessage> notifier = NotificationManager::postMessageNonBlocking;

    private static @Nullable Iterator<StableKey> cursor;
    private static long nextPassNanos;
    private static boolean passScheduled;

    private StockKeeper() {}

    /** Status of every rule on a grid at its last check; empty before the first one. */
    public static @NotNull Map<String, RuleStatus> status(@NotNull StableKey gridKey) {
        Map<String, RuleStatus> status = STATUS.get(gridKey);
        return status == null ? Collections.emptyMap() : status;
    }

    public static synchronized void onServerTick(long nowNanos, long nowMillis) {
        if (!Config.INSTANCE.stock.enabled) {
            if (!STATES.isEmpty() || !STATUS.isEmpty()) clear();
            return;
        }
        if (cursor == null) {
            if (passScheduled && nowNanos - nextPassNanos < 0) return;
            cursor = gridsWithRules().iterator();
        }
        if (cursor.hasNext()) {
            StableKey key = cursor.next();
            IAEGrid grid = CoreEngine.GRID_IDENTITIES.getGrid(key);
            // Went offline between the snapshot and this tick; the next pass picks it back up.
            if (GridFilter.isUsable(grid)) check(key, grid, nowMillis);
        }
        if (!cursor.hasNext()) {
            cursor = null;
            passScheduled = true;
            nextPassNanos = nowNanos + TimeUnit.SECONDS.toNanos(Config.INSTANCE.stock.checkIntervalSeconds);
        }
    }

    /** Server stop: drops all runtime state and abandons computing plans. Rules and alert flags stay on disk. */
    public static synchronized void clear() {
        for (GridState state : STATES.values()) {
            if (state.pending != null) state.pending.plan.cancel(true);
        }
        STATES.clear();
        STATUS.clear();
        cursor = null;
        passScheduled = false;
        nextPassNanos = 0L;
    }

    private static List<StableKey> gridsWithRules() {
        List<StableKey> keys = new ArrayList<>();
        GridIdentityRegistry registry = CoreEngine.GRID_IDENTITIES;
        if (AE2Controller.AE2Interface == null || !registry.isInitialized()) return keys;
        Set<StableKey> live = new HashSet<>();
        for (IAEGrid grid : AE2Controller.AE2Interface.web$getGrids()) {
            if (!GridFilter.isUsable(grid)) continue;
            StableKey key = registry.getKey(grid);
            if (key == null) continue;
            GridPersistentData data = registry.getPersistentData(key);
            if (data == null || data.getStockRules()
                .isEmpty()) continue;
            keys.add(key);
            live.add(key);
        }
        // A grid that lost its rules, or its identity, has nothing left to report.
        STATUS.keySet()
            .retainAll(live);
        for (Iterator<Map.Entry<StableKey, GridState>> it = STATES.entrySet()
            .iterator(); it.hasNext();) {
            Map.Entry<StableKey, GridState> entry = it.next();
            if (live.contains(entry.getKey())) continue;
            if (entry.getValue().pending != null) entry.getValue().pending.plan.cancel(true);
            it.remove();
        }
        return keys;
    }

    static void check(@NotNull StableKey gridKey, @NotNull IAEGrid grid, long nowMillis) {
        GridIdentityRegistry registry = CoreEngine.GRID_IDENTITIES;
        StockRulesData data;
        Map<String, StockRule> rules;
        synchronized (registry) {
            GridPersistentData persistent = registry.getPersistentData(gridKey);
            if (persistent == null) return;
            data = persistent.getStockRules();
            rules = data.rules();
        }
        GridState state = STATES.computeIfAbsent(gridKey, ignored -> new GridState());
        if (rules.isEmpty()) {
            if (state.pending != null) state.pending.plan.cancel(true);
            STATES.remove(gridKey);
            STATUS.remove(gridKey);
            return;
        }

        // Stored amounts and keys, by itemid. An item that isn't stored is absent here - stored 0.
        Map<String, Long> stored = new HashMap<>();
        Map<String, IAEKey> keys = new HashMap<>();
        IAEStorageGrid storageGrid = grid.web$getStorageGrid();
        if (storageGrid != null) {
            for (IAEGenericStack stack : storageGrid.web$getStorageList()
                .web$stacks()) {
                IAEKey key = stack.web$what();
                String itemid = key.web$getItemID();
                if (!rules.containsKey(itemid)) continue;
                stored.merge(itemid, stack.web$amount(), Long::sum);
                keys.putIfAbsent(itemid, key);
            }
        }
        IAECraftingGrid craftingGrid = grid.web$getCraftingGrid();
        Map<String, IAEKey> craftable = new HashMap<>();
        Set<String> beingCrafted = new HashSet<>();
        if (craftingGrid != null) {
            for (IAEKey key : craftingGrid.web$getCraftables(k -> rules.containsKey(k.web$getItemID()))) {
                craftable.putIfAbsent(key.web$getItemID(), key);
            }
            for (ICraftingCPUCluster cpu : craftingGrid.web$getCPUs()) {
                if (!cpu.web$isBusy()) continue;
                IAEGenericStack output = cpu.web$getFinalOutput();
                if (output != null) beingCrafted.add(
                    output.web$what()
                        .web$getItemID());
            }
        }

        resolvePending(state, rules, grid, craftingGrid, beingCrafted, nowMillis);
        if (state.pending != null) beingCrafted.add(state.pending.itemid);

        // Forget runtime state of deleted rules.
        state.lastAttempt.keySet()
            .retainAll(rules.keySet());
        state.lastError.keySet()
            .retainAll(rules.keySet());
        state.backoffUntil.keySet()
            .retainAll(rules.keySet());

        boolean alertsChanged = false;
        Map<String, RuleStatus> status = new LinkedHashMap<>();
        for (Map.Entry<String, StockRule> entry : rules.entrySet()) {
            String itemid = entry.getKey();
            StockRule rule = entry.getValue();
            long amount = stored.getOrDefault(itemid, 0L);

            boolean low = amount < rule.alertBelow();
            if (low != data.isLow(itemid)) {
                data.setLow(itemid, low);
                alertsChanged = true;
                if (low) alertLow(itemid, displayName(itemid, keys, craftable), amount, rule.alertBelow());
            }

            if (rule.autoCraft() && amount < rule.keepStock()
                && state.pending == null
                && !beingCrafted.contains(itemid)
                && state.backoffUntil.getOrDefault(itemid, 0L) <= nowMillis
                && craftingGrid != null) {
                IAEKey key = craftable.get(itemid);
                if (key == null || !craftingGrid.web$isCurrentlyCraftable(key)) {
                    // No pattern: nothing to retry until one appears, so no backoff - the check is cheap.
                    state.lastError.put(itemid, "No crafting pattern");
                } else {
                    long quantity = Math.max(1L, Math.min(rule.batchSize(), rule.keepStock() - amount));
                    state.lastAttempt.put(itemid, nowMillis);
                    try {
                        state.pending = new PendingPlan(
                            itemid,
                            craftingGrid.web$beginCraftingJob(grid, key, quantity),
                            nowMillis);
                        beingCrafted.add(itemid);
                    } catch (RuntimeException e) {
                        LOG.warn("Auto-stock could not plan {}x {}", quantity, itemid, e);
                        fail(state, itemid, "Could not start the plan", nowMillis);
                    }
                }
            }

            status.put(
                itemid,
                new RuleStatus(
                    itemid,
                    amount,
                    low,
                    beingCrafted.contains(itemid),
                    state.lastAttempt.getOrDefault(itemid, 0L),
                    state.lastError.get(itemid),
                    state.backoffUntil.getOrDefault(itemid, 0L)));
        }
        STATUS.put(gridKey, Collections.unmodifiableMap(status));

        if (alertsChanged) {
            synchronized (registry) {
                try {
                    registry.saveIfDirty();
                } catch (IOException e) {
                    LOG.error("Failed to save stock alert state", e);
                }
            }
        }
    }

    /**
     * Submits a finished plan, or records why it failed; leaves one still computing alone. A submitted item
     * joins {@code beingCrafted}: the CPU list was read before the submit.
     */
    private static void resolvePending(GridState state, Map<String, StockRule> rules, IAEGrid grid,
        @Nullable IAECraftingGrid craftingGrid, Set<String> beingCrafted, long nowMillis) {
        PendingPlan pending = state.pending;
        if (pending == null) return;
        if (!rules.containsKey(pending.itemid) || craftingGrid == null) {
            pending.plan.cancel(true);
            state.pending = null;
            return;
        }
        if (!pending.plan.isDone()) {
            if (nowMillis - pending.startedAt < PLAN_TIMEOUT_MILLIS) return;
            pending.plan.cancel(true);
            state.pending = null;
            fail(state, pending.itemid, "Plan took too long to compute", nowMillis);
            return;
        }
        state.pending = null;
        IAECraftingJob job;
        try {
            job = pending.plan.get();
        } catch (InterruptedException | ExecutionException | RuntimeException e) {
            fail(state, pending.itemid, "Plan failed", nowMillis);
            return;
        }
        if (job == null || job.web$isSimulation()) {
            fail(state, pending.itemid, "Missing ingredients", nowMillis);
            return;
        }
        String[] error = new String[1];
        AE2JobTracker.runAsWebRequester(REQUESTER, () -> error[0] = craftingGrid.web$submitJob(job, null, true, grid));
        if (error[0] != null) {
            fail(state, pending.itemid, error[0], nowMillis);
        } else {
            state.lastError.remove(pending.itemid);
            state.backoffUntil.remove(pending.itemid);
            beingCrafted.add(pending.itemid);
        }
    }

    private static void fail(GridState state, String itemid, String reason, long nowMillis) {
        state.lastError.put(itemid, reason);
        state.backoffUntil.put(itemid, nowMillis + BACKOFF_MILLIS);
    }

    private static String displayName(String itemid, Map<String, IAEKey> stored, Map<String, IAEKey> craftable) {
        IAEKey key = stored.get(itemid);
        if (key == null) key = craftable.get(itemid);
        return key == null ? itemid : key.web$getDisplayName();
    }

    private static void alertLow(String itemid, String name, long amount, long alertBelow) {
        // Same rule as every other notification: public mode never posts.
        if (Config.INSTANCE.general.publicMode) return;
        notifier.accept(
            new StatusMessage(
                "Low stock: " + name,
                amount + " left, below the alert level of " + alertBelow + " (" + itemid + ").",
                StatusMessage.Severity.WARNING));
    }
}
