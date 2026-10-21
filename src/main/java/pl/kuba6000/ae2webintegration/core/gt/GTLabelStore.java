package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Predicate;

import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;

/**
 * What players called things, shared by everyone who can see them, persisted to {@code gtlabels.json}: a nickname
 * and a processing line per machine, and the line capacity an EU P2P tunnel's line is built for. A line exists for
 * as long as some machine names it, so there is no line list to keep in step.
 * <p>
 * Visibility follows the labelled machine's or tunnel's owner ({@link GTVisibility}). An owner that isn't known -
 * a tunnel not scanned since a restart - passes no player's filter, so only admins see that label until a scan
 * brings the tunnel back. Entries are replaced, never mutated, as in {@link GTMachineRegistry}.
 */
public final class GTLabelStore {

    private static final int SCHEMA_VERSION = 1;
    public static final int MAX_LABEL_LENGTH = 64;
    /** {@code GT_TIERS} in the web terminal: ULV to MAX. */
    public static final int MAX_TIER = 14;
    public static final long MAX_AMPS = 1_000_000L;

    /** A machine's nickname and line; either may be {@code null}, never both. */
    public static final class MachineLabels {

        /** Shown instead of the machine's own name. */
        public final @Nullable String nickname;
        /** Processing line the machine belongs to. */
        public final @Nullable String line;

        MachineLabels(String nickname, String line) {
            this.nickname = nickname;
            this.line = line;
        }
    }

    /** {@code amps} at GT voltage tier {@code tier}. */
    public static final class TunnelCapacity {

        /** Amps the line carries. */
        public final long amps;
        /** GT voltage tier, 0 (ULV) to {@link #MAX_TIER} (MAX). */
        public final int tier;

        TunnelCapacity(long amps, int tier) {
            this.amps = amps;
            this.tier = tier;
        }

        public static boolean isValid(long amps, int tier) {
            return amps > 0 && amps <= MAX_AMPS && tier >= 0 && tier <= MAX_TIER;
        }
    }

    private static final ConcurrentHashMap<String, MachineLabels> machines = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, TunnelCapacity> tunnels = new ConcurrentHashMap<>();
    private static final AtomicBoolean dirty = new AtomicBoolean(false);
    private static final GTJsonFile<PersistedFile> file = new GTJsonFile<>("gtlabels.json", PersistedFile.class);

    private GTLabelStore() {}

    /** Trimmed and capped, or {@code null} for nothing worth storing. */
    static String normalize(String label) {
        if (label == null) {
            return null;
        }
        String trimmed = label.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() > MAX_LABEL_LENGTH ? trimmed.substring(0, MAX_LABEL_LENGTH)
            .trim() : trimmed;
    }

    // --- Visibility ---

    /** The machine's owner as last scanned, or {@code null} when it isn't known. */
    private static UUID machineOwner(String machineId) {
        GTMachineSnapshot machine = GTMachineRegistry.get(machineId);
        return machine == null ? null : machine.owner;
    }

    private static UUID tunnelOwner(String tunnelId) {
        GTTunnelStore.View tunnel = GTTunnelStore.latest(tunnelId);
        return tunnel == null ? null : tunnel.snapshot.owner;
    }

    /** Whether the machine is known and {@code visible} lets its owner through. */
    public static boolean machineVisible(String machineId, Predicate<UUID> visible) {
        return GTMachineRegistry.get(machineId) != null && visible.test(machineOwner(machineId));
    }

    public static boolean tunnelVisible(String tunnelId, Predicate<UUID> visible) {
        return GTTunnelStore.latest(tunnelId) != null && visible.test(tunnelOwner(tunnelId));
    }

    // --- Writing (HTTP threads) ---

    public static void setNickname(String machineId, String nickname) {
        String value = normalize(nickname);
        machines.compute(machineId, (id, previous) -> {
            String line = previous == null ? null : previous.line;
            return value == null && line == null ? null : new MachineLabels(value, line);
        });
        dirty.set(true);
    }

    public static void setLine(String machineId, String line) {
        String value = normalize(line);
        machines.compute(machineId, (id, previous) -> {
            String nickname = previous == null ? null : previous.nickname;
            return value == null && nickname == null ? null : new MachineLabels(nickname, value);
        });
        dirty.set(true);
    }

    /**
     * Moves every machine on line {@code from} that {@code visible} lets through to {@code to}, merging into it when
     * {@code to} already exists. Returns how many moved; a blank {@code to} takes them off any line.
     */
    public static int renameLine(String from, String to, Predicate<UUID> visible) {
        String source = normalize(from);
        if (source == null) {
            return 0;
        }
        int moved = 0;
        for (String machineId : membersOf(source, visible)) {
            setLine(machineId, to);
            moved++;
        }
        return moved;
    }

    public static void setCapacity(String tunnelId, long amps, int tier) {
        tunnels.put(tunnelId, new TunnelCapacity(amps, tier));
        dirty.set(true);
    }

    public static boolean clearCapacity(String tunnelId) {
        boolean removed = tunnelId != null && tunnels.remove(tunnelId) != null;
        if (removed) {
            dirty.set(true);
        }
        return removed;
    }

    /** The machine is gone for good: removed in the world, or not seen for {@code gt_machine_forget_days}. */
    static void forgetMachine(String machineId) {
        if (machineId != null && machines.remove(machineId) != null) {
            dirty.set(true);
        }
    }

    // --- Reading ---

    public static MachineLabels of(String machineId) {
        return machineId == null ? null : machines.get(machineId);
    }

    public static String lineOf(String machineId) {
        MachineLabels labels = of(machineId);
        return labels == null ? null : labels.line;
    }

    public static TunnelCapacity capacityOf(String tunnelId) {
        return tunnelId == null ? null : tunnels.get(tunnelId);
    }

    /** Every machine on {@code line} whose owner {@code visible} lets through. */
    public static List<String> membersOf(String line, Predicate<UUID> visible) {
        List<String> ids = new ArrayList<>();
        String wanted = normalize(line);
        if (wanted == null) {
            return ids;
        }
        for (Map.Entry<String, MachineLabels> entry : machines.entrySet()) {
            if (wanted.equals(entry.getValue().line) && machineVisible(entry.getKey(), visible)) {
                ids.add(entry.getKey());
            }
        }
        return ids;
    }

    /** The labels {@code visible} may see. */
    public static final class Snapshot {

        public final Map<String, MachineLabels> machines = new LinkedHashMap<>();
        public final Map<String, TunnelCapacity> tunnels = new LinkedHashMap<>();
    }

    public static Snapshot snapshot(Predicate<UUID> visible) {
        Snapshot snapshot = new Snapshot();
        for (Map.Entry<String, MachineLabels> entry : machines.entrySet()) {
            if (visible.test(machineOwner(entry.getKey()))) {
                snapshot.machines.put(entry.getKey(), entry.getValue());
            }
        }
        for (Map.Entry<String, TunnelCapacity> entry : tunnels.entrySet()) {
            if (visible.test(tunnelOwner(entry.getKey()))) {
                snapshot.tunnels.put(entry.getKey(), entry.getValue());
            }
        }
        return snapshot;
    }

    // --- Persistence ---

    private static final class PersistedFile {

        int schemaVersion = SCHEMA_VERSION;
        Map<String, MachineLabels> machines = new LinkedHashMap<>();
        Map<String, TunnelCapacity> tunnels = new LinkedHashMap<>();
    }

    private static PersistedFile buildSnapshot() {
        PersistedFile snapshot = new PersistedFile();
        snapshot.machines.putAll(machines);
        snapshot.tunnels.putAll(tunnels);
        return snapshot;
    }

    static void loadData() {
        PersistedFile loaded = file.load();
        machines.clear();
        tunnels.clear();
        dirty.set(false);
        if (loaded == null) {
            return;
        }
        if (loaded.machines != null) {
            for (Map.Entry<String, MachineLabels> entry : loaded.machines.entrySet()) {
                MachineLabels labels = entry.getValue();
                if (entry.getKey() == null || labels == null) {
                    continue;
                }
                String nickname = normalize(labels.nickname);
                String line = normalize(labels.line);
                if (nickname != null || line != null) {
                    machines.put(entry.getKey(), new MachineLabels(nickname, line));
                }
            }
        }
        if (loaded.tunnels != null) {
            for (Map.Entry<String, TunnelCapacity> entry : loaded.tunnels.entrySet()) {
                TunnelCapacity capacity = entry.getValue();
                if (entry.getKey() != null && capacity != null
                    && TunnelCapacity.isValid(capacity.amps, capacity.tier)) {
                    tunnels.put(entry.getKey(), capacity);
                }
            }
        }
    }

    /**
     * Saves in the background when anything changed. Called after every edit as well as from maintenance, since an
     * edit is rare and should survive a crash.
     */
    public static void flushIfDirty() {
        if (dirty.compareAndSet(true, false)) {
            file.saveAsync(buildSnapshot());
        }
    }

    static void saveNow() {
        dirty.set(false);
        file.saveNow(buildSnapshot());
    }

    /** For tests and world switches within one JVM; the file on disk is left alone. */
    static void clear() {
        machines.clear();
        tunnels.clear();
        dirty.set(false);
    }
}
