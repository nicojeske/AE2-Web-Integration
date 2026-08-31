package pl.kuba6000.ae2webintegration.core;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import pl.kuba6000.ae2webintegration.core.api.IServerPlatform;
import pl.kuba6000.ae2webintegration.core.api.PlayerIdentity;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.config.CoreData;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAESecurityGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAEStorageGrid;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;
import pl.kuba6000.ae2webintegration.core.utils.VersionChecker;

public class CoreEngine {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    /**
     * Wall clock a single tick may spend draining queued requests, one tenth of a 50 ms tick.
     * <p>
     * Time rather than a request count, because the harm being bounded is overrunning the tick and the
     * cost of a request varies by orders of magnitude - {@code /items} on a large network against
     * {@code /gettracking} - so no count can bound the time.
     */
    static final long DRAIN_BUDGET_NANOS = 5_000_000L;
    static final long PLAN_SWEEP_INTERVAL_NANOS = TimeUnit.MINUTES.toNanos(1);
    static final int PLAN_SWEEP_GRIDS_PER_TICK = 8;

    private static long nextPlanSweepNanos;
    private static boolean planSweepScheduled;
    private static boolean planSweepInProgress;

    /**
     * One grid's storage list is walked per tick it takes to sample it - the same O(network size) cost as
     * {@code /items} - so a whole sampling pass is spread one grid per tick rather than done in a batch,
     * unlike {@link #PLAN_SWEEP_GRIDS_PER_TICK}'s cheap per-grid work.
     */
    static final long HISTORY_FLUSH_INTERVAL_NANOS = TimeUnit.MINUTES.toNanos(15);

    private static Iterator<Long> historySampleCursor;
    private static long historySamplePassMillis;
    private static long nextHistorySampleNanos;
    private static boolean historySampleScheduled;

    private static long nextHistoryFlushNanos;
    private static boolean historyFlushScheduled;

    // Populated by the interface layer from the buildscript-generated mod version.
    private static volatile String modVersion;

    public static void init(IServerPlatform serverPlatform, String modVersion, String versionIdentifier) {
        VersionChecker.setVersionIdentifier(versionIdentifier);
        AE2Controller.serverPlatform = serverPlatform;
        Config.init(serverPlatform.getConfigDirectory());
        CoreEngine.modVersion = modVersion;
        loadData();
    }

    private static void loadData() {
        CoreData.loadData();
        GridData.loadData();
        ItemHistoryStore.loadData();
    }

    public static void onServerStarted() {
        AE2Controller.init();
        StartupHandler.logOpenAdminAccessWarning();
        StartupHandler.logOutdatedWarning();
        StartupHandler.handleDiscordIntegration();
    }

    /**
     * Runs the queued synced requests on the server thread. The interface layer supplies nothing but the
     * platform's tick event - cadence, bounding and fault handling are decisions that belong here, not in
     * four copies of an event handler that no test can reach.
     */
    public static void onServerTick() {
        drainRequests(System::nanoTime);
        runPlanMaintenance(System.nanoTime());
        runHistorySampling(System.nanoTime(), System.currentTimeMillis());
    }

    /** Called from the platform's player-login event, which already runs on the server thread. */
    public static void onPlayerSeen(PlayerIdentity player) {
        CoreData.observePlayer(player);
    }

    /** The clock is the one thing a test cannot control from outside, as in {@code RateLimiter}. */
    static void drainRequests(LongSupplier nanoClock) {
        long deadline = nanoClock.getAsLong() + DRAIN_BUDGET_NANOS;
        IServerThreadTask task;
        while ((task = AE2Controller.requests.poll()) != null) {
            try {
                task.runOnServerThread(AE2Controller.AE2Interface);
            } catch (Throwable t) {
                // Throwable, not Exception, and on purpose. This runs inside the server tick event, which
                // rethrows: anything escaping here stops being a failed request and becomes a stopped
                // server. A runaway handler ending in StackOverflowError should not cost the world, and an
                // OutOfMemoryError resurfaces at the next allocation regardless.
                LOG.error(
                    "Server-thread task " + task.getClass()
                        .getSimpleName() + " failed",
                    t);
                task.failIfPending("INTERNAL_ERROR");
            }
            // Checked after handling, never before, so a request costlier than the whole budget still runs
            // and can never starve the queue.
            if (nanoClock.getAsLong() >= deadline) {
                break;
            }
        }
    }

    static synchronized void runPlanMaintenance(long nowNanos) {
        if (!planSweepInProgress) {
            if (planSweepScheduled && nowNanos - nextPlanSweepNanos < 0) {
                return;
            }
            planSweepInProgress = true;
        }

        if (GridData.evictExpiredCompletedPlans(nowNanos, PLAN_SWEEP_GRIDS_PER_TICK)) {
            planSweepInProgress = false;
            planSweepScheduled = true;
            nextPlanSweepNanos = nowNanos + PLAN_SWEEP_INTERVAL_NANOS;
        }
    }

    private static synchronized void resetPlanMaintenance() {
        nextPlanSweepNanos = 0L;
        planSweepScheduled = false;
        planSweepInProgress = false;
    }

    /**
     * One pass = one sample of every grid whose tracked-item set is non-empty, spread one grid per tick.
     * A pass starts by snapshotting which grids currently qualify and stamping a single {@code nowMillis}
     * for the whole pass, so every grid it samples lands in the same bucket regardless of how many ticks
     * the pass takes to finish. Mirrors {@link #runPlanMaintenance}'s resumable-cursor shape.
     */
    static void runHistorySampling(long nowNanos, long nowMillis) {
        if (historySampleCursor == null) {
            if (historySampleScheduled && nowNanos - nextHistorySampleNanos < 0) {
                runHistoryFlushMaintenance(nowNanos);
                return;
            }
            historySampleCursor = trackedGridKeysSnapshot().iterator();
            historySamplePassMillis = nowMillis;
        }

        if (historySampleCursor.hasNext()) {
            sampleOneGrid(historySampleCursor.next(), historySamplePassMillis);
        }

        if (!historySampleCursor.hasNext()) {
            historySampleCursor = null;
            historySampleScheduled = true;
            nextHistorySampleNanos = nowNanos + TimeUnit.MINUTES.toNanos(Config.STATISTICS_SAMPLE_INTERVAL_MINUTES());
        }

        runHistoryFlushMaintenance(nowNanos);
    }

    private static void runHistoryFlushMaintenance(long nowNanos) {
        if (historyFlushScheduled && nowNanos - nextHistoryFlushNanos < 0) {
            return;
        }
        ItemHistoryStore.flushIfDirty();
        historyFlushScheduled = true;
        nextHistoryFlushNanos = nowNanos + HISTORY_FLUSH_INTERVAL_NANOS;
    }

    private static List<Long> trackedGridKeysSnapshot() {
        List<Long> keys = new ArrayList<>();
        if (AE2Controller.AE2Interface == null) {
            return keys;
        }
        for (IAEGrid grid : AE2Controller.AE2Interface.web$getGrids()) {
            IAESecurityGrid security = GridFilter.usableSecurity(grid);
            if (security == null) {
                continue;
            }
            long gridKey = security.web$getSecurityKey();
            if (gridKey == -1) {
                continue;
            }
            GridData data = GridData.find(gridKey);
            if (data == null || data.getTrackedItems()
                .isEmpty()) {
                continue;
            }
            keys.add(gridKey);
        }
        return keys;
    }

    private static void sampleOneGrid(long gridKey, long nowMillis) {
        if (AE2Controller.AE2Interface == null) {
            return;
        }
        GridData data = GridData.find(gridKey);
        if (data == null) {
            return;
        }
        Set<String> tracked = data.getTrackedItems();
        if (tracked.isEmpty()) {
            return;
        }
        for (IAEGrid grid : AE2Controller.AE2Interface.web$getGrids()) {
            IAESecurityGrid security = GridFilter.usableSecurity(grid);
            if (security == null || security.web$getSecurityKey() != gridKey) {
                continue;
            }
            IAEStorageGrid storageGrid = grid.web$getStorageGrid();
            if (storageGrid == null) {
                return;
            }
            ItemHistoryStore.sample(gridKey, tracked, storageGrid.web$getStorageList(), nowMillis);
            return;
        }
        // Grid went offline or unattachable between the pass snapshot and this tick - skip, the next pass
        // will pick it back up if it comes back.
    }

    private static synchronized void resetHistorySampling() {
        historySampleCursor = null;
        historySampleScheduled = false;
        nextHistorySampleNanos = 0L;
        historyFlushScheduled = false;
        nextHistoryFlushNanos = 0L;
    }

    public static void onServerStopping() {
        AE2Controller.stopHTTPServer();
        // Authorization must not survive into the next world loaded in this JVM.
        GridAccessSessions.clear();
        // Blocking here is fine - this runs during a deliberate shutdown, not inside the tick budget.
        ItemHistoryStore.saveNow();
    }

    public static synchronized void onServerStopped() {
        // Defensive when startup failed partway or a platform omits the earlier stopping callback.
        AE2Controller.stopHTTPServer();
        AE2Controller.clearWorldState();
        GridAccessSessions.clear();
        AE2JobTracker.clearActiveJobs();
        GridData.clearRuntimeState();
        resetPlanMaintenance();
        ItemHistoryStore.clearRuntimeState();
        resetHistorySampling();
    }

    public static String getModVersion() {
        return modVersion;
    }
}
