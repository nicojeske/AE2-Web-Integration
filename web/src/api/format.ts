// Ported from the old src/main/resources/assets/webpage.html. Item names can carry Minecraft
// section-sign (§) formatting codes from the AE2 item registry - these two are meant to be used
// together: strip for plain-text contexts, parse for display.

import type { StatsRange } from "./types";

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

/**
 * `mode` mirrors the Settings modal's `numberFormat` (`state/prefs.tsx`) - "compact" restores the
 * legacy jQuery UI's large-quantity readability at GTNH scale (`1.2M` instead of `1,204,532`). Defaults
 * to `"full"` so every existing call site (most of them never show GTNH-scale quantities) is unaffected
 * until it opts in.
 */
export function formatNumber(n: number, mode: "full" | "compact" = "full"): string {
    if (mode === "compact") {
        return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    }
    return n.toLocaleString("en-US");
}

/** `"just now"` / `"12s ago"` / `"3m ago"` / `"2h ago"` - the topbar's items-freshness label (M11). */
export function formatRelativeAge(fetchedAtMs: number, nowMs: number = Date.now()): string {
    const seconds = Math.max(0, Math.round((nowMs - fetchedAtMs) / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

/** `"Today, 14:02"` / `"Yesterday, 22:15"` / `"12 Mar, 14:02"` / a full locale string across years. */
export function formatTimestamp(ms: number): string {
    const date = new Date(ms);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (dayDiff === 0) return `Today, ${time}`;
    if (dayDiff === 1) return `Yesterday, ${time}`;
    if (date.getFullYear() === now.getFullYear()) {
        return `${date.toLocaleDateString("en-US", { day: "numeric", month: "short" })}, ${time}`;
    }
    return date.toLocaleString("en-US");
}

/**
 * Short axis label for a Statistics chart, scaled to what's distinguishable at the range's own
 * resolution - a clock time at 15m/1h/6h/24h (5-min buckets), a day at 7d/30d, month+year at 1y/all
 * (hourly buckets, so individual days aren't meaningful). `"custom"` has no resolution of its own, so
 * `spanMillis` (the request's own span, e.g. `history.to - history.from`) decides instead.
 */
export function formatAxisTime(ms: number, range: StatsRange, spanMillis?: number): string {
    const date = new Date(ms);
    const clock = () => date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const day = () => date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    const monthYear = () => date.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    if (range === "custom") {
        if (spanMillis === undefined || spanMillis <= 86_400_000) return clock();
        if (spanMillis <= 30 * 86_400_000) return day();
        return monthYear();
    }
    if (range === "15m" || range === "1h" || range === "6h" || range === "24h") return clock();
    if (range === "7d" || range === "30d") return day();
    return monthYear();
}
