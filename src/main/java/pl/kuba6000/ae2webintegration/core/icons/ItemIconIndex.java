package pl.kuba6000.ae2webintegration.core.icons;

import java.io.File;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * Maps item/fluid display names to real icon PNGs exported from an in-game item panel (JEI/NEI-style),
 * because AE2 item textures are otherwise unavailable on a headless server. The export is keyed by
 * display name, not itemid - there is nothing else to bridge on, since the export predates any
 * connection to this mod - so this is a best-effort, occasionally lossy match rather than an exact one.
 * <p>
 * Immutable once built: {@link #scan(File)} produces a fresh instance from a one-time directory
 * listing; the caller (AE2Controller) swaps a volatile reference rather than mutating an existing one,
 * so a lookup never observes a half-built index.
 */
public final class ItemIconIndex {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    private static final ItemIconIndex DISABLED = new ItemIconIndex(Collections.emptyMap(), false);

    private final Map<String, File> byNormalizedName;
    private final boolean enabled;

    private ItemIconIndex(Map<String, File> byNormalizedName, boolean enabled) {
        this.byNormalizedName = byNormalizedName;
        this.enabled = enabled;
    }

    /** The no-op index: every lookup misses. Used when no directory is configured. */
    public static ItemIconIndex disabled() {
        return DISABLED;
    }

    /**
     * Scans {@code directory} once for {@code *.png} files and indexes them by normalized filename (see
     * {@link #normalize(String)}). Never throws - a missing, empty, or unreadable directory yields an
     * index that behaves exactly like {@link #disabled()}, just logged so a misconfigured path is
     * visible instead of silently doing nothing.
     */
    public static ItemIconIndex scan(File directory) {
        if (directory == null) {
            return disabled();
        }
        File[] files = directory.listFiles(
            (dir, name) -> name.toLowerCase(Locale.ROOT)
                .endsWith(".png"));
        if (files == null) {
            LOG.warn(
                "item_icon_directory '" + directory
                    + "' does not exist or is not a readable directory - item icons"
                    + " disabled");
            return disabled();
        }
        // Sorted so that which file wins a normalized-name collision is deterministic, not
        // filesystem-listing-order dependent.
        Arrays.sort(files, Comparator.comparing(File::getName));

        Map<String, File> map = new HashMap<>();
        int collisions = 0;
        for (File file : files) {
            String key = normalize(stripExtension(file.getName()));
            if (map.putIfAbsent(key, file) != null) {
                collisions++;
            }
        }
        if (files.length == 0) {
            LOG.warn("item_icon_directory '" + directory + "' contains no .png files - item icons disabled");
            return disabled();
        }
        if (collisions > 0) {
            LOG.info(
                "item icon index: loaded " + map.size()
                    + " icons from '"
                    + directory
                    + "' ("
                    + collisions
                    + " filenames collided after normalization and were skipped)");
        } else {
            LOG.info("item icon index: loaded " + map.size() + " icons from '" + directory + "'");
        }
        return new ItemIconIndex(map, true);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public int size() {
        return byNormalizedName.size();
    }

    /**
     * Looks up the icon for a (possibly §-formatted) item display name. Returns {@code null} on any
     * miss, including a disabled index - callers fall back to the generated placeholder tile in that
     * case, never an error.
     * <p>
     * The returned {@link File}, when non-null, always came out of {@link #scan(File)}'s own directory
     * listing - {@code rawName} is never used to construct a {@code File} path, so this can never escape
     * the scanned directory regardless of what a client sends. The character rejections below are
     * defense in depth on top of that, not the actual safety boundary.
     */
    public File lookup(String rawName) {
        if (!enabled || rawName == null) {
            return null;
        }
        if (rawName.indexOf('/') >= 0 || rawName.indexOf('\\') >= 0
            || rawName.indexOf("..") >= 0
            || rawName.indexOf('\0') >= 0) {
            return null;
        }
        return byNormalizedName.get(normalize(rawName));
    }

    /**
     * Normalizes a display name (or filename, minus extension) into a lookup key: strips Minecraft
     * §-formatting codes, folds the punctuation the icon export itself substituted for path-unsafe
     * characters ({@code /}, {@code \}, {@code :} → {@code _}), collapses whitespace runs, and
     * lowercases. Exact otherwise - accented/non-ASCII characters such as {@code ³} are matched
     * byte-for-byte, not folded.
     */
    static String normalize(String name) {
        String stripped = skipFormatCodes(name);
        StringBuilder out = new StringBuilder(stripped.length());
        boolean lastWasSpace = false;
        for (int i = 0; i < stripped.length(); i++) {
            char c = stripped.charAt(i);
            if (c == '/' || c == '\\' || c == ':') {
                c = '_';
            }
            if (Character.isWhitespace(c)) {
                if (lastWasSpace) continue;
                lastWasSpace = true;
                out.append(' ');
            } else {
                lastWasSpace = false;
                out.append(c);
            }
        }
        return out.toString()
            .trim()
            .toLowerCase(Locale.ROOT);
    }

    /** Java port of the web frontend's {@code skipSpecialFormat} (web/src/api/format.ts). */
    static String skipFormatCodes(String name) {
        if (name.indexOf('§') < 0) {
            return name;
        }
        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            if (name.charAt(i) == '§') {
                i++; // skip the code character too
                continue;
            }
            out.append(name.charAt(i));
        }
        return out.toString();
    }

    static String stripExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot < 0 ? filename : filename.substring(0, dot);
    }
}
