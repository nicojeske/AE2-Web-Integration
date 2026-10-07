package pl.kuba6000.ae2webintegration.core.grid;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.jetbrains.annotations.NotNull;

/** Mutable configuration owned by one retained grid identity. */
@SuppressWarnings("SynchronizeOnNonFinalField") // Bound to the registry before publication; never rebound while in use.
public final class GridSettingsData {

    /**
     * Whether this grid records crafting activity.
     * 
     * @example true
     */
    private boolean isTracked;
    /**
     * Item ids this grid samples stored-count history for (see {@code ItemHistoryStore}).
     */
    private Set<String> trackedItems = new LinkedHashSet<>();
    /**
     * Last display name observed for each tracked item, so an item that has since emptied out of the network
     * still shows a real name and matches its icon.
     *
     * @keyExample minecraft:iron_ingot:0
     */
    private Map<String, String> trackedItemNames = new LinkedHashMap<>();
    private transient @NotNull Object lock = this;
    private transient @NotNull Runnable markDirty = () -> {};

    /** Bound before publication; getters, edits and persistence then share the registry monitor. */
    void attach(@NotNull Object lock, @NotNull Runnable markDirty) {
        this.lock = lock;
        this.markDirty = markDirty;
    }

    public boolean isTracked() {
        synchronized (lock) {
            return isTracked;
        }
    }

    public void setTracked(boolean value) {
        synchronized (lock) {
            if (isTracked == value) return;
            isTracked = value;
            markDirty.run();
        }
    }

    /** An unmodifiable snapshot; edits replace the whole set. */
    public @NotNull Set<String> getTrackedItems() {
        synchronized (lock) {
            return trackedItems == null ? Collections.emptySet()
                : Collections.unmodifiableSet(new LinkedHashSet<>(trackedItems));
        }
    }

    /** Also drops remembered names of items no longer tracked. */
    public void setTrackedItems(@NotNull Collection<String> items) {
        synchronized (lock) {
            Set<String> next = new LinkedHashSet<>(items);
            if (next.equals(trackedItems)) return;
            trackedItems = next;
            Map<String, String> pruned = new LinkedHashMap<>(getNames());
            pruned.keySet()
                .retainAll(next);
            trackedItemNames = pruned;
            markDirty.run();
        }
    }

    /** An unmodifiable snapshot. */
    public @NotNull Map<String, String> getTrackedItemNames() {
        synchronized (lock) {
            return Collections.unmodifiableMap(new LinkedHashMap<>(getNames()));
        }
    }

    /**
     * Merges freshly observed {@code itemid -> displayName} pairs from one sampling pass into the remembered
     * names, restricted to currently tracked items. Marks the settings dirty only when a name actually changed.
     */
    public void updateTrackedItemNames(@NotNull Map<String, String> observed) {
        synchronized (lock) {
            if (observed.isEmpty() || trackedItems == null) return;
            Map<String, String> next = new LinkedHashMap<>(getNames());
            boolean changed = false;
            for (Map.Entry<String, String> entry : observed.entrySet()) {
                if (trackedItems.contains(entry.getKey()) && !entry.getValue()
                    .equals(next.put(entry.getKey(), entry.getValue()))) {
                    changed = true;
                }
            }
            if (changed) {
                trackedItemNames = next;
                markDirty.run();
            }
        }
    }

    // Gson bypasses field initializers for records saved before these fields existed.
    private Map<String, String> getNames() {
        return trackedItemNames == null ? Collections.emptyMap() : trackedItemNames;
    }

    public boolean isDefault() {
        synchronized (lock) {
            return !isTracked && (trackedItems == null || trackedItems.isEmpty());
        }
    }

}
