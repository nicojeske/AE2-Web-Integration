package pl.kuba6000.ae2webintegration.core.icons;

import java.io.File;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * Maps itemids to real icon PNGs rendered by the mod's client-side icon exporter and uploaded to the server
 * ({@link IconUpload}), because item textures are otherwise unavailable on a headless server. Every file is named
 * after the item's itemid (see {@link IconFileNames}), so a lookup is an exact match on the same key the web
 * terminal already uses.
 * <p>
 * Immutable once built: {@link #scan(File)} produces a fresh instance from a one-time directory
 * listing; the caller (IconHandler) swaps a volatile reference rather than mutating an existing one,
 * so a lookup never observes a half-built index.
 */
public final class ItemIconIndex {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    private static final ItemIconIndex DISABLED = new ItemIconIndex(Collections.emptyMap(), false);

    private final Map<String, File> byItemId;
    private final boolean enabled;

    private ItemIconIndex(Map<String, File> byItemId, boolean enabled) {
        this.byItemId = byItemId;
        this.enabled = enabled;
    }

    /** The no-op index: every lookup misses. Used when no directory is configured. */
    public static ItemIconIndex disabled() {
        return DISABLED;
    }

    /**
     * Scans {@code directory} once for icon files named by {@link IconFileNames} and indexes them by itemid.
     * Files that aren't an exporter's output are skipped. Never throws - a missing, empty, or unreadable
     * directory (no icons uploaded yet) yields an index that behaves exactly like {@link #disabled()}.
     */
    public static ItemIconIndex scan(File directory) {
        if (directory == null) {
            return disabled();
        }
        File[] files = directory.listFiles();
        if (files == null) {
            LOG.info("No item icons in '" + directory + "' - upload them in-game with /ae2webicons export");
            return disabled();
        }

        Map<String, File> map = new HashMap<>();
        int skipped = 0;
        for (File file : files) {
            String itemid = IconFileNames.itemId(file.getName());
            if (itemid == null) {
                skipped++;
            } else {
                map.put(itemid, file);
            }
        }
        if (map.isEmpty()) {
            LOG.info("No item icons in '" + directory + "' - upload them in-game with /ae2webicons export");
            return disabled();
        }
        LOG.info(
            "item icon index: loaded " + map.size()
                + " icons from '"
                + directory
                + "'"
                + (skipped > 0 ? " (" + skipped + " files not named like an icon export were ignored)" : ""));
        return new ItemIconIndex(map, true);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public int size() {
        return byItemId.size();
    }

    /**
     * Looks up the icon for an itemid. Returns {@code null} on any miss, including a disabled index - callers
     * fall back to the generated placeholder tile in that case, never an error.
     * <p>
     * The returned {@link File}, when non-null, always came out of {@link #scan(File)}'s own directory
     * listing - {@code itemid} is never used to construct a {@code File} path, so this can never escape
     * the scanned directory regardless of what a client sends.
     */
    public File lookup(String itemid) {
        if (!enabled || itemid == null) {
            return null;
        }
        return byItemId.get(itemid);
    }
}
