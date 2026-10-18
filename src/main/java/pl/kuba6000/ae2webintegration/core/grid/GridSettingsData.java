package pl.kuba6000.ae2webintegration.core.grid;

import java.util.Objects;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

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
     * Display name given by a player; {@code null} when the grid has none.
     *
     * @example Main base
     */
    private @Nullable String name;
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

    public @Nullable String getName() {
        synchronized (lock) {
            return name;
        }
    }

    /** Trims the name; a blank one clears it. */
    public void setName(@Nullable String value) {
        String normalized = value == null || value.trim()
            .isEmpty() ? null : value.trim();
        synchronized (lock) {
            if (Objects.equals(name, normalized)) return;
            name = normalized;
            markDirty.run();
        }
    }

    public boolean isDefault() {
        synchronized (lock) {
            return !isTracked && name == null;
        }
    }

}
