package pl.kuba6000.ae2webintegration.core.grid;

import java.util.Objects;

/**
 * One item's stock target on a grid. Immutable; an edit replaces the whole rule.
 * <p>
 * A plain class rather than a record: Gson 2.2.4 (the oldest Minecraft ships) cannot construct records.
 */
public final class StockRule {

    /**
     * Notify once when the stored amount drops below this. Zero never alerts.
     *
     * @example 100
     */
    private long alertBelow;
    /**
     * Auto-craft tops the stored amount back up to this.
     *
     * @example 200
     */
    private long keepStock;
    /**
     * Most one auto-craft orders at a time.
     *
     * @example 64
     */
    private long batchSize;
    /**
     * Whether the server crafts the item when it drops below {@code keepStock}.
     *
     * @example true
     */
    private boolean autoCraft;

    public StockRule(long alertBelow, long keepStock, long batchSize, boolean autoCraft) {
        this.alertBelow = alertBelow;
        this.keepStock = keepStock;
        this.batchSize = batchSize;
        this.autoCraft = autoCraft;
    }

    public long alertBelow() {
        return alertBelow;
    }

    public long keepStock() {
        return keepStock;
    }

    public long batchSize() {
        return batchSize;
    }

    public boolean autoCraft() {
        return autoCraft;
    }

    /** Also run on rules loaded from disk, where Gson skips the constructor. */
    public boolean isValid() {
        return alertBelow >= 0 && keepStock >= 0 && batchSize >= 1;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof StockRule other)) return false;
        return alertBelow == other.alertBelow && keepStock == other.keepStock
            && batchSize == other.batchSize
            && autoCraft == other.autoCraft;
    }

    @Override
    public int hashCode() {
        return Objects.hash(alertBelow, keepStock, batchSize, autoCraft);
    }
}
