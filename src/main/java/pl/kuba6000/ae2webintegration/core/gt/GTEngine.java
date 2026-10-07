package pl.kuba6000.ae2webintegration.core.gt;

import java.util.concurrent.TimeUnit;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import pl.kuba6000.ae2webintegration.core.api.gt.GTScanResult;
import pl.kuba6000.ae2webintegration.core.api.gt.IGTProvider;
import pl.kuba6000.ae2webintegration.core.config.Config;

/**
 * Drives the GregTech side from the server tick: one {@link IGTProvider#scan} every
 * {@code gt_scan_interval_seconds}, a power history point every {@code gt_power_sample_interval_seconds},
 * and periodic pruning and background saves. Everything else in this package is passive storage.
 * <p>
 * The scan is the only part that touches live GregTech state, and it runs whole within one tick. It is a
 * single pass over loaded tile entities, so it is cheap, but it is still timed: the duration is exposed
 * on {@code /api/gt/machines} and a slow scan is logged.
 */
public final class GTEngine {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    static final long MAINTENANCE_INTERVAL_NANOS = TimeUnit.MINUTES.toNanos(15);
    /** A scan slower than this is logged as a warning, at most once per {@link #SLOW_SCAN_LOG_INTERVAL_NANOS}. */
    static final long SLOW_SCAN_NANOS = TimeUnit.MILLISECONDS.toNanos(5);
    static final long SLOW_SCAN_LOG_INTERVAL_NANOS = TimeUnit.MINUTES.toNanos(10);
    /** After a scan throws, wait this long before trying again rather than failing every interval. */
    static final long FAILURE_BACKOFF_NANOS = TimeUnit.MINUTES.toNanos(1);

    private static volatile IGTProvider provider;

    private static boolean scanScheduled;
    private static long nextScanNanos;
    private static boolean powerSampleScheduled;
    private static long nextPowerSampleNanos;
    private static boolean maintenanceScheduled;
    private static long nextMaintenanceNanos;
    private static long nextSlowScanLogNanos;

    private static volatile long lastScanMillis;
    private static volatile long lastScanMicros;

    private GTEngine() {}

    public static void registerProvider(IGTProvider gtProvider) {
        provider = gtProvider;
        LOG.info("GregTech provider registered, /gt endpoints enabled");
    }

    /** Whether the GregTech pages should be offered at all: a provider exists and the config allows it. */
    public static boolean isAvailable() {
        return provider != null && Config.INSTANCE.gregtech.enabled;
    }

    public static long lastScanMillis() {
        return lastScanMillis;
    }

    public static long lastScanMicros() {
        return lastScanMicros;
    }

    public static void loadData() {
        GTMachineRegistry.loadData();
        GTPowerHistoryStore.loadData();
        GTProductionLog.loadData();
    }

    public static void onServerTick() {
        onServerTick(System.nanoTime(), System.currentTimeMillis());
    }

    static synchronized void onServerTick(long nowNanos, long nowMillis) {
        if (!isAvailable()) {
            return;
        }
        if (!scanScheduled || nowNanos - nextScanNanos >= 0) {
            runScan(nowNanos, nowMillis);
        }
        if (!maintenanceScheduled) {
            // Nothing new to prune or save on the first tick after startup; start the clock instead.
            maintenanceScheduled = true;
            nextMaintenanceNanos = nowNanos + MAINTENANCE_INTERVAL_NANOS;
        } else if (nowNanos - nextMaintenanceNanos >= 0) {
            nextMaintenanceNanos = nowNanos + MAINTENANCE_INTERVAL_NANOS;
            GTPowerHistoryStore.prune(nowMillis);
            GTProductionLog.prune(nowMillis);
            GTMachineRegistry.flushIfDirty();
            GTPowerHistoryStore.flushIfDirty();
            GTProductionLog.flushIfDirty();
        }
    }

    private static void runScan(long nowNanos, long nowMillis) {
        scanScheduled = true;
        GTScanResult result;
        long started = System.nanoTime();
        try {
            result = provider.scan(nowMillis);
        } catch (Throwable t) {
            // Throwable on purpose, as in CoreEngine.drainRequests: this runs inside the server tick, and a
            // broken scan must cost the GregTech pages, never the server.
            LOG.error("GregTech scan failed, retrying in a minute", t);
            nextScanNanos = nowNanos + FAILURE_BACKOFF_NANOS;
            return;
        }
        long elapsed = System.nanoTime() - started;
        nextScanNanos = nowNanos + TimeUnit.SECONDS.toNanos(Config.INSTANCE.gregtech.scanIntervalSeconds);
        if (result == null) {
            return;
        }

        GTVisibility.mergeTeams(result.teams);
        GTMachineRegistry.apply(result.machines, nowMillis);
        GTPowerHistoryStore.updateLatest(result.powerSources, nowMillis);
        if (!powerSampleScheduled || nowNanos - nextPowerSampleNanos >= 0) {
            powerSampleScheduled = true;
            nextPowerSampleNanos = nowNanos
                + TimeUnit.SECONDS.toNanos(Config.INSTANCE.gregtech.powerSampleIntervalSeconds);
            GTPowerHistoryStore.recordSample(result.powerSources, nowMillis);
        }

        lastScanMillis = nowMillis;
        lastScanMicros = TimeUnit.NANOSECONDS.toMicros(elapsed);
        if (elapsed > SLOW_SCAN_NANOS && nowNanos - nextSlowScanLogNanos >= 0) {
            nextSlowScanLogNanos = nowNanos + SLOW_SCAN_LOG_INTERVAL_NANOS;
            LOG.warn(
                "GregTech scan took " + lastScanMicros
                    + " us for "
                    + result.machines.size()
                    + " machines; consider raising gt_scan_interval_seconds");
        }
    }

    public static void onServerStopping() {
        GTMachineRegistry.saveNow();
        GTPowerHistoryStore.saveNow();
        GTProductionLog.saveNow();
    }

    /**
     * Resets scheduling only. The provider stays registered (it is registered once at mod init, not per
     * world) and stored data stays in memory, like {@code ItemHistoryStore}.
     */
    public static synchronized void onServerStopped() {
        scanScheduled = false;
        nextScanNanos = 0L;
        powerSampleScheduled = false;
        nextPowerSampleNanos = 0L;
        maintenanceScheduled = false;
        nextMaintenanceNanos = 0L;
        nextSlowScanLogNanos = 0L;
    }

    /** Test hook: forget the provider and every stored GregTech datum in memory. */
    static synchronized void resetForTests() {
        provider = null;
        onServerStopped();
        lastScanMillis = 0L;
        lastScanMicros = 0L;
        GTVisibility.clear();
        GTMachineRegistry.clear();
        GTPowerHistoryStore.clear();
        GTProductionLog.clear();
    }
}
