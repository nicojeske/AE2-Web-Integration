package pl.kuba6000.ae2webintegration.core;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.api.IServerPlatform;
import pl.kuba6000.ae2webintegration.core.api.PlayerIdentity;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.config.CoreData;
import pl.kuba6000.ae2webintegration.core.grid.GridData;
import pl.kuba6000.ae2webintegration.core.grid.GridFilter;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.service.IAEStorageGrid;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;
import pl.kuba6000.ae2webintegration.core.utils.ReleaseManifest;
import pl.kuba6000.ae2webintegration.core.utils.VersionChecker;

public class CoreEngine {

    public static final GridIdentityRegistry GRID_IDENTITIES = new GridIdentityRegistry();

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    /**
     * Wall clock a single tick may spend draining queued requests, one tenth of a 50 ms tick.
     * <p>
     * Time rather than a request count, because the harm being bounded is overrunning the tick and the
     * cost of a request varies by orders of magnitude - {@code /items} on a large network against
     * {@code /gettracking} - so no count can bound the time.
     */
    static final long DRAIN_BUDGET_NANOS = TimeUnit.MILLISECONDS.toNanos(5);
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

    private static Iterator<StableKey> historySampleCursor;
    private static long historySamplePassMillis;
    private static long nextHistorySampleNanos;
    private static boolean historySampleScheduled;

    private static long nextHistoryFlushNanos;
    private static boolean historyFlushScheduled;

    // Populated by the interface layer from the buildscript-generated mod version.
    private static volatile String modVersion;
    private static String versionIdentifier;
    private static volatile @Nullable VersionChecker versionChecker;
    private static boolean serverRunning;

    public static void init(IServerPlatform serverPlatform, String modVersion, String versionIdentifier) {
        serverRunning = false;
        stopVersionChecker();
        CoreEngine.versionIdentifier = versionIdentifier;
        AE2Controller.serverPlatform = serverPlatform;
        Config.init(serverPlatform.getConfigDirectory(), serverPlatform::getLegacyConfig);
        CoreEngine.modVersion = modVersion;
        loadData();
    }

    private static void loadData() {
        CoreData.loadData();
        // Before the GT stores load: they read their metadata from the database.
        HistoryDb.start();
        GTEngine.loadData();
    }

    public static void onServerStarted() {
        try {
            CoreEngine.GRID_IDENTITIES.initialize(AE2Controller.serverPlatform.getWorldDirectory());
        } catch (IOException e) {
            LOG.error("Failed to load grid identities; grid requests remain unavailable", e);
        }
        serverRunning = true;
        AE2Controller.init();
        StartupHandler.logOpenAdminAccessWarning();
        maintainVersionChecker();
        StartupHandler.handleNotificationIntegration();
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
        GTEngine.onServerTick();
        maintainVersionChecker();
    }

    private static void maintainVersionChecker() {
        if (!serverRunning) return;
        if (!Config.INSTANCE.general.checkForUpdates) {
            stopVersionChecker();
        } else if (versionChecker == null && modVersion != null) {
            try {
                VersionChecker checker = new VersionChecker(
                    new URL("https://raw.githubusercontent.com/nicojeske/AE2-Web-Integration/version/"),
                    modVersion,
                    versionIdentifier);
                versionChecker = checker;
                checker.checkForUpdates();
            } catch (MalformedURLException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    private static void stopVersionChecker() {
        VersionChecker checker = versionChecker;
        if (checker != null) {
            checker.close();
            versionChecker = null;
        }
    }

    public static @Nullable ReleaseManifest.Release getAvailableUpdate() {
        VersionChecker checker = versionChecker;
        return checker == null ? null : checker.getAvailableUpdate();
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
                    "Server-thread task {} failed",
                    task.getClass()
                        .getSimpleName(),
                    t);
                task.failIfPending(ApiStatus.INTERNAL_ERROR);
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
     * One pass = one sample of every usable grid, spread one grid per tick; nothing without a history database.
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
            nextHistorySampleNanos = nowNanos
                + TimeUnit.MINUTES.toNanos(Config.INSTANCE.statistics.sampleIntervalMinutes);
        }

        runHistoryFlushMaintenance(nowNanos);
    }

    private static void runHistoryFlushMaintenance(long nowNanos) {
        if (historyFlushScheduled && nowNanos - nextHistoryFlushNanos < 0) {
            return;
        }
        ItemHistoryStore.prune(System.currentTimeMillis());
        historyFlushScheduled = true;
        nextHistoryFlushNanos = nowNanos + HISTORY_FLUSH_INTERVAL_NANOS;
    }

    private static List<StableKey> trackedGridKeysSnapshot() {
        List<StableKey> keys = new ArrayList<>();
        if (HistoryDb.get() == null || AE2Controller.AE2Interface == null || !GRID_IDENTITIES.isInitialized()) {
            return keys;
        }
        for (IAEGrid grid : AE2Controller.AE2Interface.web$getGrids()) {
            if (!GridFilter.isUsable(grid)) {
                continue;
            }
            StableKey key = GRID_IDENTITIES.getKey(grid);
            if (key != null) {
                keys.add(key);
            }
        }
        return keys;
    }

    private static void sampleOneGrid(StableKey gridKey, long nowMillis) {
        IAEGrid grid = GRID_IDENTITIES.getGrid(gridKey);
        // Grid went offline or unattachable between the pass snapshot and this tick - skip, the next pass
        // will pick it back up if it comes back.
        if (!GridFilter.isUsable(grid)) {
            return;
        }
        IAEStorageGrid storageGrid = grid.web$getStorageGrid();
        if (storageGrid != null) {
            ItemHistoryStore.sample(gridKey.toString(), storageGrid.web$getStorageList(), nowMillis);
        }
    }

    static void resetHistorySamplingForTest() {
        resetHistorySampling();
    }

    private static synchronized void resetHistorySampling() {
        historySampleCursor = null;
        historySampleScheduled = false;
        nextHistorySampleNanos = 0L;
        historyFlushScheduled = false;
        nextHistoryFlushNanos = 0L;
    }

    public static void onServerStopping() {
        serverRunning = false;
        stopVersionChecker();
        AE2Controller.stopHTTPServer();
        // Authorization must not survive into the next world loaded in this JVM.
        GRID_IDENTITIES.clear();
        // Blocking here is fine - this runs during a deliberate shutdown, not inside the tick budget.
        GTEngine.onServerStopping();
        HistoryDb db = HistoryDb.get();
        if (db != null && !db.flush(TimeUnit.SECONDS.toMillis(10))) {
            LOG.warn("The history database did not confirm the last history writes before shutdown");
        }
    }

    public static synchronized void onServerStopped() {
        serverRunning = false;
        stopVersionChecker();
        // Defensive when startup failed partway or a platform omits the earlier stopping callback.
        AE2Controller.stopHTTPServer();
        AE2Controller.clearWorldState();
        AE2JobTracker.clearActiveJobs();
        GridData.clearRuntimeState();
        CoreEngine.GRID_IDENTITIES.clear();
        resetPlanMaintenance();
        resetHistorySampling();
        GTEngine.onServerStopped();
    }

    public static String getModVersion() {
        return modVersion;
    }
}
