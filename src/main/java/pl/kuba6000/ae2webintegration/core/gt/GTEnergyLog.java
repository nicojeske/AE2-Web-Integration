package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryTable;

/**
 * EU every machine consumed or generated, summed per hour in the history database: each scan credits a running
 * machine's EU/t times the ticks since the previous scan. Ticks, not wall time, so lag doesn't inflate the totals.
 * A sample per scan rather than an exact count, but unbiased over many scans; Lapotronic Supercapacitors are
 * storage, not use, and have their own history.
 */
public final class GTEnergyLog {

    public static final String CONSUMED = "consumed";
    public static final String GENERATED = "generated";

    static final long HOUR_MILLIS = TimeUnit.HOURS.toMillis(1);
    private static final int TICKS_PER_SECOND = 20;

    private static long lastTickCount = -1L;

    private GTEnergyLog() {}

    // --- Writing (server thread) ---

    static void record(List<GTMachineSnapshot> scanned, long nowMillis, long tickCount) {
        HistoryDb db = HistoryDb.get();
        long previous = lastTickCount;
        lastTickCount = tickCount;
        if (db == null || scanned == null || previous < 0L) return;
        long ticks = tickCount - previous;
        if (ticks <= 0) return;
        // As in GTStateLog: past two scans' worth, something stalled - credit one scan, not the gap.
        long scanTicks = (long) Config.INSTANCE.gregtech.scanIntervalSeconds * TICKS_PER_SECOND;
        if (ticks > 2 * scanTicks) ticks = scanTicks;
        long hourStart = Math.floorDiv(nowMillis, HOUR_MILLIS) * HOUR_MILLIS;
        for (GTMachineSnapshot machine : scanned) {
            if (machine == null || machine.id == null
                || machine.status != GTMachineStatus.RUNNING
                || machine.euPerTick == 0
                || GTPowerHistoryStore.latest(GTPowerSourceSnapshot.lscId(machine.dim, machine.x, machine.y, machine.z))
                    != null) {
                continue;
            }
            long perTick = machine.euPerTick == Long.MIN_VALUE ? Long.MAX_VALUE : Math.abs(machine.euPerTick);
            long eu = perTick > Long.MAX_VALUE / ticks ? Long.MAX_VALUE : perTick * ticks;
            db.addCounter(
                HistoryTable.GT_EU_HOURLY,
                machine.id,
                machine.euPerTick > 0 ? CONSUMED : GENERATED,
                hourStart,
                eu);
        }
    }

    static void prune(long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) return;
        db.prune(
            HistoryTable.GT_EU_HOURLY,
            nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.stateRetentionDays),
            nowMillis);
    }

    static void clear() {
        lastTickCount = -1L;
    }

    // --- Reading (HTTP threads) ---

    /** EU per machine in {@code [from, to]}: {consumed, generated}, for every visible known machine with any. */
    public static Map<String, long[]> totals(long fromMillis, long toMillis, Predicate<UUID> ownerFilter) {
        Map<String, long[]> byMachine = new HashMap<>();
        HistoryDb db = HistoryDb.get();
        if (db == null) return byMachine;
        List<String> ids = new ArrayList<>();
        for (GTMachineSnapshot machine : GTMachineRegistry.all()) {
            if (ownerFilter.test(machine.owner)) ids.add(machine.id);
        }
        for (HistoryDb.CounterTotal total : db.readCounterTotals(
            HistoryTable.GT_EU_HOURLY,
            ids,
            Math.floorDiv(fromMillis, HOUR_MILLIS),
            Math.floorDiv(toMillis, HOUR_MILLIS),
            HOUR_MILLIS)) {
            long[] eu = byMachine.computeIfAbsent(total.scope, k -> new long[2]);
            eu[GENERATED.equals(total.key) ? 1 : 0] += total.total;
        }
        return byMachine;
    }
}
