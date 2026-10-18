package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import pl.kuba6000.ae2webintegration.core.analysis.BottleneckAnalysis;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * How long every machine spent in each {@link GTMachineStatus}, summed per hour in the history database: each
 * scan credits the time since the previous one to the status the machine is in now. Unloaded machines are not
 * scanned and get nothing, so the totals cover observed time only. Without a database nothing is recorded.
 */
public final class GTStateLog {

    static final long HOUR_MILLIS = TimeUnit.HOURS.toMillis(1);
    public static final String NO_POWER = key(GTMachineStatus.NO_POWER);

    private static long lastRecordMillis;

    private GTStateLog() {}

    /**
     * Prefix of the keys that split idle time by {@link GTMachineSnapshot#idleReason}: a breakdown of the
     * {@code idle} total, not a status of its own.
     */
    public static final String IDLE_REASON_PREFIX = "idle:";

    /** Running parallels and the parallel limit, each times the scan interval; not statuses. */
    public static final String PARALLELS_USED = "parallels:used";
    public static final String PARALLELS_MAX = "parallels:max";

    /** Series key of a status: its enum name in lower case, stable because the enum is part of the contract. */
    public static String key(GTMachineStatus status) {
        return status.name()
            .toLowerCase(Locale.ROOT);
    }

    // --- Writing (server thread) ---

    static void record(List<GTMachineSnapshot> scanned, long nowMillis) {
        HistoryDb db = HistoryDb.get();
        long previous = lastRecordMillis;
        lastRecordMillis = nowMillis;
        if (db == null || scanned == null || previous == 0L) {
            return;
        }
        // A gap longer than two scans is a stalled or paused server: credit one scan, not the whole gap.
        long scanMillis = TimeUnit.SECONDS.toMillis(Config.INSTANCE.gregtech.scanIntervalSeconds);
        long elapsed = nowMillis - previous;
        if (elapsed <= 0) {
            return;
        }
        if (elapsed > 2 * scanMillis) {
            elapsed = scanMillis;
        }
        long hourStart = Math.floorDiv(nowMillis, HOUR_MILLIS) * HOUR_MILLIS;
        for (GTMachineSnapshot machine : scanned) {
            if (machine == null || machine.id == null || machine.status == null) {
                continue;
            }
            db.addCounter(HistoryTable.GT_STATE_HOURLY, machine.id, key(machine.status), hourStart, elapsed);
            if (machine.status == GTMachineStatus.RUNNING && machine.maxParallels > 1 && machine.parallels > 0) {
                // Parallel-milliseconds, so used / max over any range is the time-weighted parallel use.
                db.addCounter(
                    HistoryTable.GT_STATE_HOURLY,
                    machine.id,
                    PARALLELS_USED,
                    hourStart,
                    Math.min(machine.parallels, machine.maxParallels) * elapsed);
                db.addCounter(
                    HistoryTable.GT_STATE_HOURLY,
                    machine.id,
                    PARALLELS_MAX,
                    hourStart,
                    (long) machine.maxParallels * elapsed);
            }
            if (machine.status == GTMachineStatus.IDLE && machine.idleReason != null) {
                db.addCounter(
                    HistoryTable.GT_STATE_HOURLY,
                    machine.id,
                    IDLE_REASON_PREFIX + machine.idleReason,
                    hourStart,
                    elapsed);
            }
        }
    }

    static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return;
        }
        db.prune(
            HistoryTable.GT_STATE_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.stateRetentionDays),
            nowMillis);
    }

    static void clear() {
        lastRecordMillis = 0L;
    }

    // --- Reading (HTTP threads) ---

    /** Milliseconds per status key for every visible known machine with any time in {@code [from, to]}. */
    public static Map<String, Map<String, Long>> totals(long fromMillis, long toMillis, Predicate<UUID> ownerFilter) {
        Map<String, Map<String, Long>> byMachine = new HashMap<>();
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return byMachine;
        }
        List<String> ids = new ArrayList<>();
        for (GTMachineSnapshot machine : GTMachineRegistry.all()) {
            if (ownerFilter.test(machine.owner)) {
                ids.add(machine.id);
            }
        }
        for (HistoryDb.CounterTotal total : db.readCounterTotals(
            HistoryTable.GT_STATE_HOURLY,
            ids,
            Math.floorDiv(fromMillis, HOUR_MILLIS),
            Math.floorDiv(toMillis, HOUR_MILLIS),
            HOUR_MILLIS)) {
            byMachine.computeIfAbsent(total.scope, k -> new HashMap<>())
                .put(total.key, total.total);
        }
        return byMachine;
    }

    /**
     * The hours in {@code [from, to]} in which any known machine was out of power, as a check for
     * {@link BottleneckAnalysis}. Hour resolution is coarse, but it only labels intervals that are already
     * outliers, so it says why one ran long rather than deciding whether it counts.
     */
    public static BottleneckAnalysis.OutageCheck outages(long fromMillis, long toMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            return BottleneckAnalysis.OutageCheck.NONE;
        }
        List<String> ids = new ArrayList<>();
        for (GTMachineSnapshot machine : GTMachineRegistry.all()) {
            ids.add(machine.id);
        }
        long fromHour = Math.floorDiv(fromMillis, HOUR_MILLIS);
        long toHour = Math.floorDiv(toMillis, HOUR_MILLIS);
        long[] noPower = db
            .readCounterWindows(HistoryTable.GT_STATE_HOURLY, ids, NO_POWER, fromHour, toHour, 1, HOUR_MILLIS);
        return (start, end) -> {
            long first = Math.max(fromHour, Math.floorDiv(start, HOUR_MILLIS));
            long last = Math.min(toHour, Math.floorDiv(end, HOUR_MILLIS));
            for (long hour = first; hour <= last; hour++) {
                if (noPower[(int) (hour - fromHour)] > 0) return true;
            }
            return false;
        };
    }
}
