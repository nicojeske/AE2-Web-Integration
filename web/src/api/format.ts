// Ported from the old src/main/resources/assets/webpage.html. Item names can carry Minecraft
// section-sign (§) formatting codes from the AE2 item registry - these two are meant to be used
// together: strip for plain-text contexts, parse for display.

const EXTRA_FORMAT_CHARS = "klmno"; // obfuscated, bold, strikethrough, underline, italic
const RESET_CHAR = "r";

/** Strips `§`-formatting codes, leaving plain text (safe for `<title>`, alt text, sort keys, etc). */
export function skipSpecialFormat(name: string): string {
    if (!name.includes("§")) return name;
    let out = "";
    for (let i = 0; i < name.length; i++) {
        if (name[i] === "§") {
            i++; // skip the code character too
            continue;
        }
        out += name[i];
    }
    return out;
}

/**
 * Converts `§`-formatting codes into nested `<span class="mc-fmt-X">` markup, matching the legacy
 * renderer byte for byte - including its quirk that a color code only closes formatting spans opened
 * since the previous color code, not earlier color spans, unlike real Minecraft chat formatting. Only
 * feed this through `dangerouslySetInnerHTML` on trusted server-controlled item names (the same trust
 * boundary the old UI used), never on arbitrary user input.
 */
export function parseSpecialFormat(name: string): string {
    let out = "";
    let spanCount = 0;
    let extraCount = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name[i];
        if (char === "§") {
            const code = name[++i];
            if (code === undefined) break;
            if (EXTRA_FORMAT_CHARS.includes(code)) {
                extraCount++;
            } else if (code === RESET_CHAR) {
                out += "</span>".repeat(spanCount);
                spanCount = 0;
                extraCount = 0;
                continue;
            } else if (extraCount > 0) {
                out += "</span>".repeat(extraCount);
                spanCount -= extraCount;
                extraCount = 0;
            }
            out += `<span class="mc-fmt-${code}">`;
            spanCount++;
        } else {
            out += char;
        }
    }
    out += "</span>".repeat(spanCount);
    return out;
}

/** `4096` -> `4 KB`, `2202009.6` -> `2.1 MB`. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(1)} ${units[i]}`;
}

/**
 * Combined-unit duration, matching the design's copy (`4m 12s`, `1h 03m`) - not the old webpage.html's
 * single-unit `formatTime`, which the new screens never use verbatim.
 */
export function formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0s";
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatPercent(fraction: number): string {
    return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(fraction);
}

export function formatNumber(n: number): string {
    return n.toLocaleString("en-US");
}
