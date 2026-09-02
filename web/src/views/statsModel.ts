// Pure model for the Statistics section (M8) - geometry, gap handling, and normalisation math live
// here, dependency-free, mirroring browserModel.ts/orderModel.ts. See REDESIGN_MILESTONES.md's M7
// notes for the wire facts this code assumes (point count != requested `points`, the newest point is
// usually a gap, "all" is the hourly retention window not unbounded, etc).
import type { SegmentedOption } from "../ui/SegmentedControl";
import { HISTORY_NO_SAMPLE, type StatsRange } from "../api/types";

export const CARD_W = 240;
export const CARD_H = 70;
export const CARD_PAD = 4;
export const COMPARE_W = 680;
export const COMPARE_H = 260;
export const COMPARE_PAD = 14;

/** Points requested for a 240px-wide card sparkline - roughly one sample per plotted x-unit. */
export const CARD_POINTS = 240;
/** Points requested for the 680px-wide compare chart - the server's own cap (`GetItemHistory.java`). */
export const COMPARE_POINTS = 500;
/** The compare palette (`--series-1..6`) has six colours - a seventh series would double-assign one. */
export const MAX_COMPARE_SERIES = 6;

/**
 * The design's four ranges (default 7d) plus finer presets and a free-entry custom span. `1y` stays in
 * `StatsRange` for wire fidelity but isn't offered here - at the server's default 365-day hourly
 * retention it is identical to "all".
 */
export const RANGE_OPTIONS: SegmentedOption<StatsRange>[] = [
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "6h", label: "6h" },
    { value: "24h", label: "Last 24h" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "all", label: "All time" },
    { value: "custom", label: "Custom" },
];

/** Default span (in minutes) a range control switches to when first landing on "custom". */
export const DEFAULT_CUSTOM_MINUTES = 60;

/** `Settings.statsChartSize` -> chart plot height in px. */
export const CHART_SIZE_PX: Record<"s" | "m" | "l", number> = { s: 70, m: 110, l: 160 };

export const CHART_SCALE_OPTIONS: SegmentedOption<ChartScale>[] = [
    { value: "linear", label: "Linear" },
    { value: "log", label: "Log" },
];

export type CustomRangeUnit = "minutes" | "hours" | "days";

const CUSTOM_UNIT_MINUTES: Record<CustomRangeUnit, number> = {
    minutes: 1,
    hours: 60,
    days: 60 * 24,
};

/** Amount+unit -> minutes for the `custom` range's `minutes` wire param, floored to at least 1. */
export function customRangeToMinutes(amount: number, unit: CustomRangeUnit): number {
    return Math.max(1, Math.round(amount * CUSTOM_UNIT_MINUTES[unit]));
}

export interface Point {
    x: number;
    y: number;
}

export interface SeriesGeometry {
    /** Index-aligned with the input values; `null` at a gap. */
    pts: (Point | null)[];
    /** Contiguous runs of real points - each becomes its own SVG subpath. */
    segments: Point[][];
    linePath: string;
    areaPath: string;
    hasData: boolean;
}

/** `-1` -> `null`. Convert the wire sentinel exactly once, right at the API boundary. */
export function toValues(points: number[]): (number | null)[] {
    return points.map((v) => (v === HISTORY_NO_SAMPLE ? null : v));
}

export function extent(values: (number | null)[]): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return min === Infinity ? null : { min, max };
}

export function firstNonGap(values: (number | null)[]): { index: number; value: number } | null {
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v !== null && v !== undefined) return { index: i, value: v };
    }
    return null;
}

export function lastNonGap(values: (number | null)[]): { index: number; value: number } | null {
    for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        if (v !== null && v !== undefined) return { index: i, value: v };
    }
    return null;
}

/** `null` when there are fewer than two non-gap samples, or the first is `0` (percent-of-zero). */
export function deltaPercent(values: (number | null)[]): number | null {
    const first = firstNonGap(values);
    const last = lastNonGap(values);
    if (!first || !last || first.index === last.index || first.value === 0) return null;
    return ((last.value - first.value) / first.value) * 100;
}

/**
 * `values`/`min`/`max` -> plot geometry, with one deliberate change from the prototype's
 * `chartGeometry` for each of: gaps (breaks into per-run subpaths instead of one continuous path),
 * a flat/zero series (`span<=0` centres at `h/2` rather than being welded to the floor by `span||1`),
 * and a lone sample (`x=w/2` rather than `x=0`).
 */
export function chartGeometry(
    values: (number | null)[],
    min: number,
    max: number,
    w: number,
    h: number,
    pad: number,
): SeriesGeometry {
    const n = values.length;
    const span = max - min;
    const xOf = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
    const yOf = (v: number) => (span <= 0 ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2));

    const pts: (Point | null)[] = new Array(n).fill(null);
    const segments: Point[][] = [];
    let current: Point[] = [];
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v === null || v === undefined) {
            if (current.length) {
                segments.push(current);
                current = [];
            }
            continue;
        }
        const p = { x: xOf(i), y: yOf(v) };
        pts[i] = p;
        current.push(p);
    }
    if (current.length) segments.push(current);

    const linePath = segments
        .map((seg) => {
            const first = seg[0]!;
            return seg.length === 1
                ? `M${first.x.toFixed(1)},${first.y.toFixed(1)} L${first.x.toFixed(1)},${first.y.toFixed(1)}`
                : seg.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
        })
        .join(" ");

    // Each segment closes at its own first/last x, not the viewBox edges - closing at 0/w would
    // smear the fill across gaps and past the ends of a partial series.
    const areaPath = segments
        .filter((seg) => seg.length >= 2)
        .map((seg) => {
            const first = seg[0]!;
            const last = seg[seg.length - 1]!;
            const body = seg.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            return `M${first.x.toFixed(1)},${h} ${body} L${last.x.toFixed(1)},${h} Z`;
        })
        .join(" ");

    return { pts, segments, linePath, areaPath, hasData: segments.length > 0 };
}

/** Timestamp of point `i`, per the server's own semantics - never interpolated between `from`/`to`. */
export function pointTimestamps(from: number, stepMillis: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => from + i * stepMillis);
}

export type NormalizeMode = "first" | "peak" | "flat" | "none";

export interface NormalizedSeries {
    itemid: string;
    mode: NormalizeMode;
    baseline: number | null;
    /** Percent-of-baseline; gaps stay `null`. */
    normalized: (number | null)[];
}

/**
 * Normalises to % of the series' first *non-gap* value (never `values[0]`, which is usually `-1`,
 * and never the prototype's `values[0] || 1`). A zero baseline has no meaningful percent, so those
 * series fall back to their own peak instead of being silently dropped or divided by a fudge factor.
 */
export function normalizeSeries(itemid: string, values: (number | null)[]): NormalizedSeries {
    const first = firstNonGap(values);
    if (!first) return { itemid, mode: "none", baseline: null, normalized: values.map(() => null) };

    const nonGapMax = Math.max(...values.filter((v): v is number => v !== null));

    let mode: NormalizeMode;
    let scale: (v: number) => number;
    if (first.value > 0) {
        mode = "first";
        scale = (v) => (v / first.value) * 100;
    } else if (nonGapMax > 0) {
        mode = "peak";
        scale = (v) => (v / nonGapMax) * 100;
    } else {
        mode = "flat";
        scale = () => 100;
    }

    return {
        itemid,
        mode,
        baseline: first.value,
        normalized: values.map((v) => (v === null ? null : scale(v))),
    };
}

/** Shared y-domain across every drawn compare series, unioned with 100 (the reference line). */
export function sharedDomain(series: NormalizedSeries[]): { min: number; max: number } {
    const all = series.flatMap((s) => s.normalized).filter((v): v is number => v !== null);
    all.push(100);
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (max - min < 1) {
        min -= 1;
        max += 1;
    }
    return { min, max };
}

/** `"5-min samples"` / `"1 point ~ 45 min (5-min samples)"` / `"hourly samples"`. */
export function describeResolution(resolution: "fine" | "hourly", stepMillis: number): string {
    const tierMs = resolution === "fine" ? 5 * 60_000 : 60 * 60_000;
    const tierLabel = resolution === "fine" ? "5-min samples" : "hourly samples";
    if (stepMillis <= tierMs) return tierLabel;
    return `1 point ~ ${formatSpan(stepMillis)} (${tierLabel})`;
}

function formatSpan(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
    return `${Math.round(hours / 24)}d`;
}

/** "All time" is the hourly retention window, not unbounded - said honestly, from the response itself. */
export function retentionNote(from: number, to: number): string {
    const days = Math.max(1, Math.round((to - from) / 86_400_000));
    return `All time = the last ${days} days the server keeps`;
}

export interface TrackableSource {
    itemid: string;
    name: string;
    /** `null` when the item is tracked but no longer present in the loaded item list. */
    quantity: number | null;
}

export interface TrackableRow extends TrackableSource {
    tracked: boolean;
}

/** Tracked items sort first, then by plain name; filters on both name and itemid. */
export function buildTrackableRows(rows: TrackableSource[], tracked: string[], query: string): TrackableRow[] {
    const trackedSet = new Set(tracked);
    const q = query.trim().toLowerCase();
    return rows
        .filter((r) => !q || r.name.toLowerCase().includes(q) || r.itemid.toLowerCase().includes(q))
        .map((r) => ({ ...r, tracked: trackedSet.has(r.itemid) }))
        .sort((a, b) => Number(b.tracked) - Number(a.tracked) || a.name.localeCompare(b.name));
}

// --- Dashboard metrics (chart-quality/derived-metrics improvement pass) ---

export interface SeriesStats {
    first: number | null;
    last: number | null;
    min: number | null;
    max: number | null;
    /** Index into the input `values` where `min`/`max` occurred - `null` iff `min`/`max` is `null`. */
    minIndex: number | null;
    maxIndex: number | null;
    avg: number | null;
    stdDev: number | null;
    /** Non-gap sample count. */
    samples: number;
    gaps: number;
    /** Least-squares slope over every non-gap point (not just first/last), in value units per hour.
     *  `null` under 2 samples - matches `deltaPercent`'s own "not enough samples" threshold. */
    slopePerHour: number | null;
    /** `last - first` (non-gap); `null` under the same conditions as `deltaPercent`. */
    changeAbs: number | null;
    changePct: number | null;
}

/**
 * Gap-aware summary stats for one series. `slopePerHour` is a least-squares fit, not
 * `(last-first)/span` - the server's downsampling keeps the newest non-gap value per window
 * (`ItemHistoryStore.readSeries`), so a single spiky endpoint shouldn't get to define "the rate".
 */
export function seriesStats(values: (number | null)[], stepMillis: number): SeriesStats {
    const firstEntry = firstNonGap(values);
    const lastEntry = lastNonGap(values);

    let min = Infinity;
    let max = -Infinity;
    let minIndex: number | null = null;
    let maxIndex: number | null = null;
    let sum = 0;
    let samples = 0;
    let gaps = 0;
    // Least-squares accumulators over (x = sample time in hours, y = value).
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || v === undefined) {
            gaps++;
            continue;
        }
        samples++;
        sum += v;
        if (v < min) {
            min = v;
            minIndex = i;
        }
        if (v > max) {
            max = v;
            maxIndex = i;
        }
        const xHours = (i * stepMillis) / 3_600_000;
        sumX += xHours;
        sumY += v;
        sumXY += xHours * v;
        sumXX += xHours * xHours;
    }

    const avg = samples > 0 ? sum / samples : null;
    let stdDev: number | null = null;
    if (avg !== null) {
        let variance = 0;
        for (const v of values) {
            if (v === null || v === undefined) continue;
            variance += (v - avg) ** 2;
        }
        stdDev = Math.sqrt(variance / samples);
    }

    let slopePerHour: number | null = null;
    if (samples >= 2) {
        const denom = samples * sumXX - sumX * sumX;
        if (denom !== 0) slopePerHour = (samples * sumXY - sumX * sumY) / denom;
    }

    const changeAbs =
        firstEntry && lastEntry && firstEntry.index !== lastEntry.index ? lastEntry.value - firstEntry.value : null;

    return {
        first: firstEntry?.value ?? null,
        last: lastEntry?.value ?? null,
        min: min === Infinity ? null : min,
        max: max === -Infinity ? null : max,
        minIndex,
        maxIndex,
        avg,
        stdDev,
        samples,
        gaps,
        slopePerHour,
        changeAbs,
        changePct: deltaPercent(values),
    };
}

/**
 * Projected time until the series' last value hits zero at its current `slopePerHour`, presented as
 * an estimate ("empty in ~4h 20m at current rate"), never as a fact. `null` whenever that projection
 * isn't meaningful: flat/rising slope, no current value, or too few samples for a slope at all.
 */
export function timeToEmptyMillis(stats: SeriesStats): number | null {
    if (stats.slopePerHour === null || stats.slopePerHour >= 0) return null;
    if (stats.last === null || stats.last <= 0) return null;
    const hours = stats.last / -stats.slopePerHour;
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return hours * 3_600_000;
}

/**
 * Up to `count` axis ticks spanning `[min, max]` exactly - the ends are always included verbatim
 * (a y-axis should read the real min/max, never a rounded neighbour that implies a false floor or
 * ceiling), with intermediate ticks snapped to a "nice" 1/2/5 x 10^n step.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    if (max <= min || count < 2) return [min];

    const span = max - min;
    const rawStep = span / (count - 1);
    const exp = Math.floor(Math.log10(rawStep));
    const base = rawStep / 10 ** exp;
    const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
    const step = niceBase * 10 ** exp;

    const ticks = [min];
    for (let v = Math.ceil(min / step) * step; v < max; v += step) {
        if (v - ticks[ticks.length - 1]! > span * 0.02) ticks.push(v);
    }
    if (max - ticks[ticks.length - 1]! > span * 0.02) ticks.push(max);
    else ticks[ticks.length - 1] = max;

    return ticks.length <= count ? ticks : [ticks[0]!, ...ticks.slice(1, count - 1), ticks[ticks.length - 1]!];
}

/** Evenly spaced sample indices for x-axis labels - snapped to real bucket indices, never interpolated
 *  between them (the timestamp at a fractional index doesn't exist on the wire). */
export function timeTickIndices(pointCount: number, tickCount: number): number[] {
    if (pointCount <= 0) return [];
    if (pointCount === 1 || tickCount <= 1) return [0];
    const n = Math.min(tickCount, pointCount);
    const indices = new Set<number>();
    for (let i = 0; i < n; i++) {
        indices.add(Math.round((i * (pointCount - 1)) / (n - 1)));
    }
    return Array.from(indices).sort((a, b) => a - b);
}

/** Points in the optional moving-average overlay - short enough to preserve real shape, long enough
 *  to visibly damp per-sample noise at the default 5-minute fine sampling interval. */
export const SMOOTHING_WINDOW = 5;

/** Gap-aware centred moving average - a window with no real samples in it stays a gap rather than
 *  fabricating a value. */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
    if (window <= 1) return values.slice();
    const half = Math.floor(window / 2);
    return values.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
            const v = values[j];
            if (v !== null && v !== undefined) {
                sum += v;
                n++;
            }
        }
        return n === 0 ? null : sum / n;
    });
}

export type ChartScale = "linear" | "log";

/** `log10(v+1)` so `0` and gaps survive - only for plotting; raw values are still shown in tooltips
 *  and the metrics row via `unscaleValue`. */
export function scaleValues(values: (number | null)[], mode: ChartScale): (number | null)[] {
    if (mode === "linear") return values;
    return values.map((v) => (v === null || v === undefined ? null : Math.log10(v + 1)));
}

/** Inverse of `scaleValues` - only meaningful for a tick label computed in scaled space. */
export function unscaleValue(v: number, mode: ChartScale): number {
    return mode === "linear" ? v : 10 ** v - 1;
}

/** Element-wise sum across series, index-aligned - a bucket is a gap only when every series is a gap
 *  there, so one item with a brief outage doesn't blank the whole aggregate. */
export function sumSeries(series: (number | null)[][]): (number | null)[] {
    if (series.length === 0) return [];
    const length = Math.max(...series.map((s) => s.length));
    const result: (number | null)[] = [];
    for (let i = 0; i < length; i++) {
        let sum = 0;
        let any = false;
        for (const s of series) {
            const v = s[i];
            if (v !== null && v !== undefined) {
                sum += v;
                any = true;
            }
        }
        result.push(any ? sum : null);
    }
    return result;
}
