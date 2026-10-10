package pl.kuba6000.ae2webintegration.core.grid;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * A grid's stock rules, keyed by itemid, shared by everyone with access to the grid. Persisted beside
 * {@link GridSettingsData} in the grid-identity file and checked by {@code stock.StockKeeper}.
 * <p>
 * {@code low} remembers which items already alerted, so a restart doesn't repeat every alert.
 */
@SuppressWarnings("SynchronizeOnNonFinalField") // Bound to the registry before publication; never rebound while in use.
public final class StockRulesData {

    public static final int MAX_RULES = 500;
    public static final int MAX_ITEMID_LENGTH = 256;

    // Never null once attached; Gson leaves them null for a file written before they existed.
    private @NotNull Map<String, StockRule> rules = new LinkedHashMap<>();
    private @NotNull Set<String> low = new LinkedHashSet<>();
    private transient @NotNull Object lock = this;
    private transient @NotNull Runnable markDirty = () -> {};

    /** Bound before publication; also repairs what an older file or a hand edit left missing or invalid. */
    @SuppressWarnings("ConstantValue") // Gson can leave the persisted fields null.
    void attach(@NotNull Object lock, @NotNull Runnable markDirty) {
        this.lock = lock;
        this.markDirty = markDirty;
        if (rules == null) rules = new LinkedHashMap<>();
        if (low == null) low = new LinkedHashSet<>();
        rules.values()
            .removeIf(rule -> rule == null || !rule.isValid());
        low.retainAll(rules.keySet());
    }

    public static boolean isValidItemId(@Nullable String itemid) {
        return itemid != null && !itemid.isEmpty() && itemid.length() <= MAX_ITEMID_LENGTH;
    }

    public @NotNull Map<String, StockRule> rules() {
        synchronized (lock) {
            return Collections.unmodifiableMap(new LinkedHashMap<>(rules));
        }
    }

    /** False when this would add a rule past {@link #MAX_RULES}; replacing an existing rule always works. */
    public boolean put(@NotNull String itemid, @NotNull StockRule rule) {
        synchronized (lock) {
            if (!rules.containsKey(itemid) && rules.size() >= MAX_RULES) return false;
            if (!rule.equals(rules.put(itemid, rule))) markDirty.run();
            return true;
        }
    }

    /** False when there was no rule for the item. */
    public boolean remove(@NotNull String itemid) {
        synchronized (lock) {
            if (rules.remove(itemid) == null) return false;
            low.remove(itemid);
            markDirty.run();
            return true;
        }
    }

    public boolean isLow(@NotNull String itemid) {
        synchronized (lock) {
            return low.contains(itemid);
        }
    }

    /** Ignored for an item without a rule, so a check racing a delete can't resurrect state. */
    public void setLow(@NotNull String itemid, boolean value) {
        synchronized (lock) {
            if (!rules.containsKey(itemid)) return;
            boolean changed = value ? low.add(itemid) : low.remove(itemid);
            if (changed) markDirty.run();
        }
    }

    public boolean isEmpty() {
        synchronized (lock) {
            return rules.isEmpty();
        }
    }
}
