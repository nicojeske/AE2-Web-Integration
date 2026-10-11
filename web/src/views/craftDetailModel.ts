// Pure view-model builder for the active Craft Detail page (the plan preview has its own model in
// orderModel.ts). No Preact here so the arithmetic is reviewable/testable in isolation - mirrors
// claude-design's `craftDetailVals()` (AE2 Web Terminal.dc.html:895-1048) against the real DTOs.
import { formatBytes, formatDuration, formatNumber } from "../api/format";
import {
    craftTotals,
    estimateRemaining,
    formatResourceAmount,
    progressUnits,
    recentRate,
    recentRemaining,
} from "../state/craftProgress";
import type { CraftTotals, ProgressSample } from "../state/craftProgress";
import type {
    CompactedItem,
    ConsumedItem,
    DimensionalCoords,
    ItemStack,
    ResourceRef,
    WorkingMachine,
} from "../api/types";
import type { CpuView } from "../state/cpus";

export type StepStage = "crafting" | "waiting" | "done";

/** One item of the job: a row of Craft Detail's step table. Amounts are per resource (fluids in L). */
export interface CraftStepRow {
    itemid: string;
    /** Raw (possibly §-formatted) - render via `<FormattedText>`. */
    itemname: string;
    stage: StepStage;
    crafted: number;
    /** What the job set out to craft of it (`planned`, else crafted + active + pending). */
    planned: number;
    active: number;
    pending: number;
    stored: number;
    /** Units per second while it was crafting; `null` untracked or before any time was spent on it. */
    rate: number | null;
    /** ms; zero untracked. */
    timeSpent: number;
    /** `0..1` of the job's summed crafting time; `null` untracked. */
    share: number | null;
}

export interface CraftDetailStat {
    label: string;
    value: string;
}

/** One input a job used up, for the "Consumed" section of both the live and the history page. */
export interface ConsumedRow {
    itemid: string;
    itemname: string;
    amount: string;
    /** Crafted by the same job - shown after, and dimmer than, the raw materials. */
    intermediate: boolean;
}

/** A pattern provider (group) still working on the job, for the "Working machines" section. */
export interface WorkingMachineRow {
    /** The provider group this row shows - the key into `matchGTMachines`' result. */
    source: WorkingMachine;
    name: string;
    location: string;
    running: string;
    items: ResourceRef[];
}

export interface CraftDetailView {
    outputItemid: string;
    /** Raw (possibly §-formatted) item name - render via `<FormattedText>`, never as a plain string. */
    outputName: string;
    outputQty: number;
    subtitle: string;
    statusLabel: string;
    statusVariant: "amber" | "green" | "grey" | "red";
    /** Elapsed/Took, Est. remaining, Crafts/sec - the Output card is rendered separately since its
     *  value needs `<FormattedText>`, not a plain string. */
    stats: CraftDetailStat[];
    /** `null` when untracked - the progress strip and caption are hidden entirely. */
    progress: { fraction: number; activeFraction: number; caption: string } | null;
    steps: CraftStepRow[];
    /** Whether the job had tracking - without it the step table has no crafted/rate/time figures. */
    tracked: boolean;
    /** `null` when untracked; otherwise raw materials first, then intermediates. */
    consumed: ConsumedRow[] | null;
    machines: WorkingMachineRow[];
    /** Set while the tracked job has made no progress for the server's stall time. */
    stall: { duration: string; reason: string | null } | null;
    finished: boolean;
}

/**
 * A busy `CpuView`'s tracked fields, frozen at the moment the job is last known to be running - kept by
 * the caller (`CraftDetail.tsx`) and fed back in once the CPU goes idle/vanishes, so the page can render
 * "Took"/"Completed" instead of collapsing to nothing.
 */
export interface CraftDetailSnapshot {
    cpuName: string;
    coProcessors: number;
    availableStorage: number;
    usedStorage: number;
    output: ItemStack;
    items: CompactedItem[];
    consumed: ConsumedItem[];
    hasTrackingInfo: boolean;
    elapsedMs: number;
}

// `usedStorage === -1` is the normal "not reported" value on modern AE2's `web$getUsedStorage()` mixin
// (also 1.7.10, when the accessor is absent) - renders as "—" rather than a literal "-1 B", matching M2.
function storageStat(usedStorage: number, availableStorage: number): string {
    return `${usedStorage === -1 ? "—" : formatBytes(usedStorage)} / ${formatBytes(availableStorage)}`;
}

/** A CPU counts as "finished" once it's no longer in `/list` as busy - shared with `CraftDetail.tsx` so
 *  it can tell "still loading this cycle's detail" apart from "genuinely finished, no snapshot ever
 *  captured" (both render `buildActiveCraftDetail(...) === null`). */
export function isJobFinished(live: CpuView | null): boolean {
    return !live?.isBusy;
}

/** Live elapsed for a still-busy tracked CPU: server `timeElapsed` plus wall-clock since it was fetched. */
export function liveElapsed(cpu: CpuView, now: number): number | null {
    if (!cpu.detail?.hasTrackingInfo || cpu.fetchedAt === null) return null;
    return cpu.detail.timeElapsed + Math.max(0, now - cpu.fetchedAt);
}

export function snapshotOf(cpu: CpuView, now: number): CraftDetailSnapshot | null {
    if (!cpu.isBusy || !cpu.finalOutput || !cpu.detail?.items) return null;
    const elapsedMs = liveElapsed(cpu, now) ?? 0;
    return {
        cpuName: cpu.name,
        coProcessors: cpu.coProcessors,
        availableStorage: cpu.availableStorage,
        usedStorage: cpu.usedStorage,
        output: cpu.finalOutput,
        items: cpu.detail.items,
        consumed: cpu.detail.consumed,
        hasTrackingInfo: cpu.detail.hasTrackingInfo,
        elapsedMs,
    };
}

/** Raw materials first (what the job actually drew from storage), each group largest first. */
export function buildConsumedRows(consumed: ConsumedItem[]): ConsumedRow[] {
    return [...consumed]
        .sort((a, b) => Number(a.alsoCrafted) - Number(b.alsoCrafted) || b.amount - a.amount)
        .map((c) => ({
            itemid: c.itemid,
            itemname: c.itemname,
            amount: formatResourceAmount(c.itemid, c.amount),
            intermediate: c.alsoCrafted,
        }));
}

export function formatLocations(location: DimensionalCoords[]): string {
    const first = location[0];
    if (!first) return "";
    const coords = `${first.x}, ${first.y}, ${first.z} (dim ${first.dimid})`;
    return location.length > 1 ? `${coords} +${location.length - 1} more` : coords;
}

function buildMachineRows(live: CpuView, now: number): WorkingMachineRow[] {
    const detail = live.detail;
    if (!detail?.hasTrackingInfo || live.fetchedAt === null) return [];
    // `since` is on the server's clock: measure against the server's "now" at fetch time, then tick on.
    const serverNow = detail.timeStarted + detail.timeElapsed + Math.max(0, now - live.fetchedAt);
    return detail.machines.map((m) => ({
        source: m,
        name: m.name,
        location: formatLocations(m.location),
        running: formatDuration(Math.max(0, serverNow - m.since)),
        items: m.items,
    }));
}

function buildStall(live: CpuView, now: number): CraftDetailView["stall"] {
    const detail = live.detail;
    if (!detail?.hasTrackingInfo || detail.stalledSince <= 0 || live.fetchedAt === null) return null;
    // `stalledSince` is on the server's clock - same reasoning as `buildMachineRows`.
    const serverNow = detail.timeStarted + detail.timeElapsed + Math.max(0, now - live.fetchedAt);
    return { duration: formatDuration(Math.max(0, serverNow - detail.stalledSince)), reason: detail.stallReason };
}

/** Builds the Craft Detail view model for active mode from a live `CpuView` or a frozen snapshot. */
export function buildActiveCraftDetail(
    live: CpuView | null,
    snapshot: CraftDetailSnapshot | null,
    now: number,
    /** This job's progress readings so far (`CraftDetail.tsx` collects them), for the recent-rate ETA. */
    samples: ProgressSample[] = [],
): CraftDetailView | null {
    if (!live || isJobFinished(live)) {
        if (!snapshot) return null;
        return buildFromSnapshot(snapshot);
    }
    const detail = live.detail;
    if (!live.finalOutput || !detail?.items) return null; // detail hasn't arrived yet this cycle

    const tracked = detail.hasTrackingInfo;
    const items = detail.items;
    const totals = craftTotals(items);
    const elapsed = liveElapsed(live, now) ?? 0;
    const progressFraction = totals.requested > 0 ? Math.min(1, totals.crafted / totals.requested) : 0;
    const stalled = detail.stalledSince > 0;
    // The recent rate once there's a minute of it - a job's early steps are often much quicker than its
    // late ones, so the whole-job average promises too soon - else the linear extrapolation.
    const recent = tracked ? recentRate(samples) : null;
    const remaining =
        tracked && !stalled
            ? (recentRemaining(samples, totals.requested) ?? estimateRemaining(elapsed, progressFraction))
            : null;
    const jobRate = tracked && elapsed > 0 ? totals.crafted / (elapsed / 1000) : 0;

    const stats: CraftDetailStat[] = [];
    if (tracked) stats.push({ label: "Progress", value: `${Math.floor(progressFraction * 100)}%` });
    stats.push({ label: "Elapsed", value: tracked ? formatDuration(elapsed) : "—" });
    if (tracked) {
        stats.push({
            label: "Est. remaining",
            value: stalled ? "Stalled" : remaining !== null ? `~${formatDuration(remaining)}` : "Calculating",
        });
        stats.push({ label: "Crafts/s", value: jobRate.toFixed(2) });
        if (recent !== null) stats.push({ label: "Last 5 min/s", value: recent.toFixed(2) });
    }

    return {
        outputItemid: live.finalOutput.itemid,
        outputName: live.finalOutput.itemname,
        outputQty: live.finalOutput.quantity,
        subtitle: `${live.name} - ${live.coProcessors} co-proc${live.coProcessors === 1 ? "" : "s"} - ${storageStat(live.usedStorage, live.availableStorage)}${detail.requestedBy ? ` - requested by ${detail.requestedBy}` : ""}`,
        statusLabel: detail.stalledSince > 0 ? "Stalled" : tracked ? "Crafting" : "Crafting - no tracking",
        statusVariant: detail.stalledSince > 0 ? "red" : "amber",
        stats,
        progress: tracked ? liveProgress(items, totals, detail.plannedTotal > 0) : null,
        steps: buildSteps(items, tracked, totals.totalTime, false),
        tracked,
        consumed: tracked ? buildConsumedRows(detail.consumed) : null,
        machines: buildMachineRows(live, now),
        stall: buildStall(live, now),
        finished: false,
    };
}

function buildFromSnapshot(snapshot: CraftDetailSnapshot): CraftDetailView {
    const { items, hasTrackingInfo: tracked, elapsedMs } = snapshot;
    const totals = craftTotals(items);
    const jobRate = tracked && elapsedMs > 0 ? totals.crafted / (elapsedMs / 1000) : 0;

    const stats: CraftDetailStat[] = [{ label: "Took", value: tracked ? formatDuration(elapsedMs) : "—" }];
    if (tracked) stats.push({ label: "Crafts/s", value: jobRate.toFixed(2) });

    return {
        outputItemid: snapshot.output.itemid,
        outputName: snapshot.output.itemname,
        outputQty: snapshot.output.quantity,
        subtitle: `${snapshot.cpuName} - ${snapshot.coProcessors} co-proc${snapshot.coProcessors === 1 ? "" : "s"} - ${storageStat(snapshot.usedStorage, snapshot.availableStorage)}`,
        statusLabel: "Completed",
        statusVariant: "green",
        stats,
        progress: tracked
            ? {
                  fraction: 1,
                  activeFraction: 0,
                  caption: `Completed - ${formatNumber(Math.round(totals.crafted))} sub-crafts recorded over ${formatDuration(elapsedMs)}`,
              }
            : null,
        steps: buildSteps(items, tracked, totals.totalTime, true),
        tracked,
        consumed: tracked ? buildConsumedRows(snapshot.consumed) : null,
        machines: [],
        stall: null,
        finished: true,
    };
}

function liveProgress(
    items: CompactedItem[],
    totals: CraftTotals,
    planned: boolean,
): NonNullable<CraftDetailView["progress"]> {
    let active = 0;
    let pending = 0;
    for (const item of items) {
        active += progressUnits(item.itemid, item.active);
        pending += progressUnits(item.itemid, item.pending);
    }
    const requested = totals.requested;
    const parts = [
        `${formatNumber(Math.round(totals.crafted))} of ${formatNumber(Math.round(requested))} sub-crafts complete`,
        `${formatNumber(Math.round(active))} in machines`,
        `${formatNumber(Math.round(pending))} waiting`,
    ];
    if (!planned) parts.push("approximated from crafted totals");
    return {
        fraction: requested > 0 ? Math.min(1, totals.crafted / requested) : 0,
        activeFraction: requested > 0 ? Math.min(1, active / requested) : 0,
        caption: parts.join(" · "),
    };
}

function stageOf(item: CompactedItem, finished: boolean): StepStage | null {
    if (finished) return "done";
    if (item.active > 0) return "crafting";
    if (item.pending > 0) return "waiting";
    return item.craftedTotal > 0 ? "done" : null;
}

function buildSteps(items: CompactedItem[], tracked: boolean, totalTime: number, finished: boolean): CraftStepRow[] {
    const rows: CraftStepRow[] = [];
    for (const item of items) {
        const stage = stageOf(item, finished);
        if (!stage) continue;
        rows.push({
            itemid: item.itemid,
            itemname: item.itemname,
            stage,
            crafted: item.craftedTotal,
            planned: item.planned > 0 ? item.planned : item.craftedTotal + item.active + item.pending,
            active: item.active,
            pending: item.pending,
            stored: item.stored,
            rate: tracked && item.timeSpentCrafting > 0 ? item.craftedTotal / (item.timeSpentCrafting / 1000) : null,
            timeSpent: tracked ? item.timeSpentCrafting : 0,
            share: tracked && totalTime > 0 ? item.timeSpentCrafting / totalTime : null,
        });
    }
    return rows;
}
