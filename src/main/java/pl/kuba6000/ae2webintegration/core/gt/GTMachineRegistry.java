package pl.kuba6000.ae2webintegration.core.gt;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;

/**
 * Every multiblock seen recently, loaded or not, persisted to {@code gtmachines.json}.
 * <p>
 * A scan only sees loaded chunks, so a machine missing from a scan is not gone - it is marked
 * {@code loaded = false} and kept with its last known state, until the adapter reports it removed
 * ({@link #remove}) or it has not been seen for {@code gt_machine_forget_days}.
 * <p>
 * Entries are replaced, never mutated, so an HTTP worker serializing one never sees it change underneath.
 */
public final class GTMachineRegistry {

    private static final int SCHEMA_VERSION = 1;

    private static final ConcurrentHashMap<String, GTMachineSnapshot> machines = new ConcurrentHashMap<>();
    private static final AtomicBoolean dirty = new AtomicBoolean(false);
    private static final GTJsonFile<PersistedFile> file = new GTJsonFile<>("gtmachines.json", PersistedFile.class);

    private GTMachineRegistry() {}

    static void apply(List<GTMachineSnapshot> scanned, long nowMillis) {
        Set<String> seen = new HashSet<>();
        if (scanned != null) {
            for (GTMachineSnapshot machine : scanned) {
                if (machine == null || machine.id == null) {
                    continue;
                }
                GTMachineSnapshot stored = machine.copy();
                stored.loaded = true;
                stored.lastSeenMillis = nowMillis;
                machines.put(stored.id, stored);
                seen.add(stored.id);
            }
        }
        long forgetBefore = nowMillis - TimeUnit.DAYS.toMillis(Config.GT_MACHINE_FORGET_DAYS());
        for (Map.Entry<String, GTMachineSnapshot> entry : machines.entrySet()) {
            if (seen.contains(entry.getKey())) {
                continue;
            }
            GTMachineSnapshot previous = entry.getValue();
            if (previous.lastSeenMillis < forgetBefore) {
                machines.remove(entry.getKey(), previous);
            } else if (previous.loaded) {
                GTMachineSnapshot unloaded = previous.copy();
                unloaded.loaded = false;
                machines.replace(entry.getKey(), previous, unloaded);
            }
        }
        dirty.set(true);
    }

    public static void remove(String machineId) {
        if (machineId != null && machines.remove(machineId) != null) {
            dirty.set(true);
        }
    }

    public static Collection<GTMachineSnapshot> all() {
        return machines.values();
    }

    public static GTMachineSnapshot get(String machineId) {
        return machineId == null ? null : machines.get(machineId);
    }

    // --- Persistence ---

    private static final class PersistedFile {

        int schemaVersion = SCHEMA_VERSION;
        Map<String, GTMachineSnapshot> machines = new LinkedHashMap<>();
    }

    private static PersistedFile buildSnapshot() {
        PersistedFile snapshot = new PersistedFile();
        for (GTMachineSnapshot machine : new ArrayList<>(machines.values())) {
            snapshot.machines.put(machine.id, machine);
        }
        return snapshot;
    }

    static void loadData() {
        PersistedFile loaded = file.load();
        machines.clear();
        if (loaded == null || loaded.machines == null) {
            return;
        }
        for (Map.Entry<String, GTMachineSnapshot> entry : loaded.machines.entrySet()) {
            GTMachineSnapshot machine = entry.getValue();
            if (entry.getKey() == null || machine == null) {
                continue;
            }
            // Nothing is loaded until the first scan after startup says so.
            machine.loaded = false;
            machine.id = entry.getKey();
            machines.put(entry.getKey(), machine);
        }
    }

    static void flushIfDirty() {
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
        dirty.set(false);
    }
}
