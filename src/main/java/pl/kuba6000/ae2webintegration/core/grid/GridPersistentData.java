package pl.kuba6000.ae2webintegration.core.grid;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.api.DimensionalCoords;

/** Durable grid data. Active crafting state remains in GridData. */
public final class GridPersistentData {

    private final Set<DimensionalCoords> controllers;
    private final GridSettingsData settings;
    // Not final: a file written before stock rules existed has none, and Gson then leaves this null.
    private StockRulesData stockRules;

    public GridPersistentData(@NotNull Set<DimensionalCoords> controllers, @NotNull GridSettingsData settings) {
        this(controllers, settings, new StockRulesData());
    }

    private GridPersistentData(@NotNull Set<DimensionalCoords> controllers, @NotNull GridSettingsData settings,
        @NotNull StockRulesData stockRules) {
        this.controllers = new LinkedHashSet<>(controllers);
        this.settings = settings;
        this.stockRules = stockRules;
    }

    public @NotNull Set<DimensionalCoords> getControllers() {
        return Collections.unmodifiableSet(controllers);
    }

    public @NotNull GridSettingsData getSettings() {
        return settings;
    }

    public @NotNull StockRulesData getStockRules() {
        return stockRules;
    }

    /** Nothing configured, so another identity claiming the same controllers loses nothing by winning. */
    public boolean isDefault() {
        return settings.isDefault() && stockRules.isEmpty();
    }

    /** Membership replacement retains the same mutable settings and stock-rule objects. */
    public @NotNull GridPersistentData withControllers(@NotNull Set<DimensionalCoords> controllers) {
        return this.controllers.equals(controllers) ? this : new GridPersistentData(controllers, settings, stockRules);
    }

    /** Also validates required fields after Gson loading, before exposing the record. */
    @SuppressWarnings("ConstantValue") // Gson can bypass the constructor and leave required fields null.
    public void attach(@NotNull Object lock, @NotNull Runnable markDirty) {
        if (controllers == null || settings == null) throw new IllegalArgumentException("Incomplete grid data");
        if (stockRules == null) stockRules = new StockRulesData();
        settings.attach(lock, markDirty);
        stockRules.attach(lock, markDirty);
    }
}
