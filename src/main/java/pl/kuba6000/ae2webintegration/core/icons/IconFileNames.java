package pl.kuba6000.ae2webintegration.core.icons;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The file naming scheme of an icon export: one {@code <encoded itemid>.png} per item or fluid, where the itemid
 * is the same string the web terminal keys items on ({@code modid:name:damage} for items, the fluid registry name
 * for fluids - items always carry a colon, fluids never do, so the two can't collide). Shared by the client-side
 * exporter that writes the files and {@link ItemIconIndex} that reads them back.
 * <p>
 * The encoding is injective and filesystem-safe on every OS: {@code [A-Za-z0-9._-]} is kept, {@code :} becomes
 * {@code ~}, and every other UTF-8 byte becomes {@code %XX} (upper-case hex). It never produces {@code /},
 * {@code \} or a leading-dot-only name such as {@code ..}, since a lone dot can't come out of a real itemid.
 */
public final class IconFileNames {

    public static final String EXTENSION = ".png";

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private IconFileNames() {}

    /** The icon file name (with extension) for {@code itemid}. */
    public static String fileName(String itemid) {
        return encode(itemid) + EXTENSION;
    }

    static String encode(String itemid) {
        StringBuilder out = new StringBuilder(itemid.length() + 8);
        for (byte b : itemid.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xFF;
            if (c == ':') {
                out.append('~');
            } else if (isKept(c)) {
                out.append((char) c);
            } else {
                out.append('%')
                    .append(HEX[c >> 4])
                    .append(HEX[c & 0xF]);
            }
        }
        return out.toString();
    }

    /**
     * The itemid an icon file name (with extension) stands for, or {@code null} for a file that isn't a
     * well-formed {@link #fileName} output - so stray files in the directory are ignored rather than indexed
     * under a key no request can produce.
     */
    public static String itemId(String fileName) {
        if (!fileName.endsWith(EXTENSION)) {
            return null;
        }
        String encoded = fileName.substring(0, fileName.length() - EXTENSION.length());
        if (encoded.isEmpty()) {
            return null;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(encoded.length());
        for (int i = 0; i < encoded.length(); i++) {
            char c = encoded.charAt(i);
            if (c == '~') {
                bytes.write(':');
            } else if (c == '%') {
                if (i + 2 >= encoded.length()) {
                    return null;
                }
                int hi = hexValue(encoded.charAt(i + 1));
                int lo = hexValue(encoded.charAt(i + 2));
                if (hi < 0 || lo < 0) {
                    return null;
                }
                bytes.write(hi << 4 | lo);
                i += 2;
            } else if (c < 0x80 && isKept(c)) {
                bytes.write(c);
            } else {
                return null;
            }
        }
        String itemid = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        // Reject non-canonical spellings (lower-case hex, an escaped kept character, invalid UTF-8): only the
        // exact file name the exporter would write for this id maps back to it.
        return encode(itemid).equals(encoded) ? itemid : null;
    }

    private static boolean isKept(int c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
            || (c >= '0' && c <= '9')
            || c == '.'
            || c == '_'
            || c == '-';
    }

    private static int hexValue(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }
}
