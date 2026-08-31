// Pure view-model builder for the tracking detail page (M5) - mirrors the split used by
// `craftDetailModel.ts` (M3/M4) so the arithmetic stays reviewable/testable in isolation.
import { formatDuration, formatNumber, formatTimestamp, skipSpecialFormat } from "../api/format";
import type { DimensionalCoords, TrackingDetail } from "../api/types";
import type { TimelineRow } from "../ui/Timeline";

/** Server sorts `items`/`interfaceShare` by share/`timingsCombined` desc already - cap rather than
 *  re-sort, so a job with dozens of interfaces doesn't produce a mile-long timeline. */
const MAX_TIMELINE_ROWS = 12;

export interface TrackingItemRow {
    itemid: string;
    itemname: string;
    stats: { label: string; value: string }[];
    /** `0..1`, or `null` when nothing has a recorded duration (denominator is 0). */
    sharePct: number | null;
}

export interface TrackingDetailStat {
    label: string;
    value: string;
}

export interface TrackingDetailView {
    /** Raw (possibly §-formatted) item name - render via `<FormattedText>`, never as a plain string. */
    outputName: string;
    /** The amount *requested* when the job started (`AE2JobTracker.addJob`), not what actually
     *  completed - for a cancelled job these can disagree; the "Crafted" stat below carries the real
     *  total. */
    outputQty: number;
    statusLabel: "Completed" | "Cancelled";
    statusVariant: "green" | "red";
    stats: TrackingDetailStat[];
    items: TrackingItemRow[];
    itemTimelineRows: TimelineRow[];
    interfaceTimelineRows: TimelineRow[];
    /** `[timeStarted, timeDone]`, fed straight to `<Timeline>`. */
    domain: [number, number];
}

/** `location` is a server-side `HashSet` (unstable iteration order) - sort so re-renders don't reshuffle
 *  the tooltip's location lines. */
function sortedLocationLines(location: DimensionalCoords[]): string[] {
    return [...location]
        .sort((a, b) => a.dimid.localeCompare(b.dimid) || a.x - b.x || a.y - b.y || a.z - b.z)
        .map((loc) => `${loc.dimid}, ${loc.x}, ${loc.y}, ${loc.z}`);
}

export function buildTrackingDetail(detail: TrackingDetail): TrackingDetailView {
    const totalTimeSpent = detail.items.reduce((sum, it) => sum + it.timeSpentOn, 0);
    const totalCrafted = detail.items.reduce((sum, it) => sum + it.craftedTotal, 0);
    const elapsed = detail.timeDone - detail.timeStarted;

    const items: TrackingItemRow[] = detail.items.map((it) => {
        // Derived, never read off the wire: `craftsPerSec`/`shareInCraftingTimeCombined` divide by
        // `timeSpentOn`/elapsed unguarded server-side (`JSON_CompactedJobTrackingInfo.java`) and can come
        // back NaN/Infinity, which Gson's non-lenient builder throws on rather than serializes - the
        // same hazard logged for `/get`'s `craftsPerSec` in REDESIGN_MILESTONES.md. `shareInCraftingTime`
        // has its own quirk of answering 1.0 for every item when the total is 0, so `null` (hidden) is
        // used instead of trusting it.
        const rate = it.timeSpentOn > 0 ? it.craftedTotal / (it.timeSpentOn / 1000) : null;
        const sharePct = totalTimeSpent > 0 ? it.timeSpentOn / totalTimeSpent : null;
        return {
            itemid: it.itemid,
            itemname: it.itemname,
            sharePct,
            stats: [
                { label: "Crafted", value: formatNumber(it.craftedTotal) },
                { label: "Time spent", value: formatDuration(it.timeSpentOn) },
                { label: "Rate", value: rate === null ? "—" : `${rate.toFixed(2)}/s` },
            ],
        };
    });

    const itemTimelineRows: TimelineRow[] = detail.items.slice(0, MAX_TIMELINE_ROWS).map((it, i) => ({
        key: `${it.itemid}:${i}`,
        label: skipSpecialFormat(it.itemname),
        segments: it.timings,
    }));

    const interfaceTimelineRows: TimelineRow[] = detail.interfaceShare.slice(0, MAX_TIMELINE_ROWS).map((iface, i) => ({
        key: `${iface.name}:${i}`,
        label: iface.name,
        segments: iface.timings,
        value: formatDuration(iface.timingsCombined),
        tooltipExtra: sortedLocationLines(iface.location),
    }));

    return {
        outputName: detail.finalOutput.itemname,
        outputQty: detail.finalOutput.quantity,
        statusLabel: detail.wasCancelled ? "Cancelled" : "Completed",
        statusVariant: detail.wasCancelled ? "red" : "green",
        stats: [
            { label: "Started", value: formatTimestamp(detail.timeStarted) },
            { label: "Took", value: formatDuration(elapsed) },
            { label: "Items", value: formatNumber(detail.items.length) },
            { label: "Crafted", value: formatNumber(totalCrafted) },
        ],
        items,
        itemTimelineRows,
        interfaceTimelineRows,
        domain: [detail.timeStarted, detail.timeDone],
    };
}
