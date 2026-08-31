// Pure view-model builder for the Craft Detail page (M3: active mode; M4 adds a plan-mode sibling
// alongside this). No Preact here so the arithmetic is reviewable/testable in isolation - mirrors
// claude-design's `craftDetailVals()` (AE2 Web Terminal.dc.html:895-1048) against the real DTOs.
import { formatBytes, formatDuration, formatNumber } from "../api/format";
import { craftTotals } from "../state/craftProgress";
import type { CompactedItem, ItemStack } from "../api/types";
import type { CpuView } from "../state/cpus";

export type CraftDetailColumnKey = "crafting" | "waiting" | "done";

export interface CraftDetailItemRow {
    itemid: string;
    itemname: string;
    /** `active`, `pending`, `stored`, and (tracked only) `crafted x/y`, `rate`, `time spent`. */
    stats: { label: string; value: string }[];
    badgeText: string;
    /** `0..1`, or `null` when untracked or this item has no recorded time. */
    sharePct: number | null;
}

export interface CraftDetailColumn {
    key: CraftDetailColumnKey;
    title: string;
    color: "amber" | "grey" | "green";
    rows: CraftDetailItemRow[];
    emptyText: string;
}

export interface CraftDetailBottleneckRow {
    itemname: string;
    /** `0..1`. */
    sharePct: number;
    label: string;
}

export interface CraftDetailStat {
    label: string;
    value: string;
}

export interface CraftDetailView {
    /** Raw (possibly §-formatted) item name - render via `<FormattedText>`, never as a plain string. */
    outputName: string;
    outputQty: number;
    subtitle: string;
    statusLabel: string;
    statusVariant: "amber" | "green" | "grey";
    /** Elapsed/Took, Est. remaining, Crafts/sec - the Output card is rendered separately since its
     *  value needs `<FormattedText>`, not a plain string. */
    stats: CraftDetailStat[];
    /** `null` when untracked - the progress block (bar + caption) is hidden entirely. */
    progress: { fraction: number; caption: string } | null;
    columns: CraftDetailColumn[];
    bottleneck: CraftDetailBottleneckRow[] | null;
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
        hasTrackingInfo: cpu.detail.hasTrackingInfo,
        elapsedMs,
    };
}

function itemRate(item: CompactedItem): string {
    if (item.timeSpentCrafting <= 0) return "-";
    return `${(item.craftedTotal / (item.timeSpentCrafting / 1000)).toFixed(2)}/s`;
}

function buildRow(item: CompactedItem, tracked: boolean, badgeText: string, totalTime: number): CraftDetailItemRow {
    const requested = item.craftedTotal + item.active + item.pending;
    const stats: CraftDetailStat[] = [
        { label: "active", value: formatNumber(item.active) },
        { label: "pending", value: formatNumber(item.pending) },
        { label: "stored", value: formatNumber(item.stored) },
    ];
    if (tracked) {
        stats.push({ label: "crafted", value: `${formatNumber(item.craftedTotal)} / ${formatNumber(requested)}` });
        stats.push({ label: "rate", value: itemRate(item) });
        stats.push({ label: "time spent", value: formatDuration(item.timeSpentCrafting) });
    }
    const share = tracked && totalTime > 0 ? item.timeSpentCrafting / totalTime : 0;
    return {
        itemid: item.itemid,
        itemname: item.itemname,
        stats,
        badgeText,
        sharePct: share > 0 ? share : null,
    };
}

/** Builds the Craft Detail view model for active mode from a live `CpuView` or a frozen snapshot. */
export function buildActiveCraftDetail(
    live: CpuView | null,
    snapshot: CraftDetailSnapshot | null,
    now: number,
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
    const etaReady = tracked && progressFraction >= 0.15 && elapsed > 20_000 && progressFraction < 1;
    const jobRate = tracked && elapsed > 0 ? totals.crafted / (elapsed / 1000) : 0;

    const stats: CraftDetailStat[] = [{ label: "Elapsed", value: tracked ? formatDuration(elapsed) : "—" }];
    if (tracked) {
        stats.push({
            label: "Est. remaining",
            value: etaReady
                ? `~${formatDuration((elapsed * (1 - progressFraction)) / progressFraction)}`
                : "Calculating",
        });
        stats.push({ label: "Crafts / sec", value: jobRate.toFixed(2) });
    }

    return {
        outputName: live.finalOutput.itemname,
        outputQty: live.finalOutput.quantity,
        subtitle: `${live.name} - ${live.coProcessors} co-proc${live.coProcessors === 1 ? "" : "s"} - ${storageStat(live.usedStorage, live.availableStorage)}`,
        statusLabel: tracked ? "Crafting" : "Crafting - no tracking",
        statusVariant: "amber",
        stats,
        progress: tracked
            ? {
                  fraction: progressFraction,
                  caption: `${formatNumber(totals.crafted)} of ${formatNumber(totals.requested)} sub-crafts complete - approximated from crafted totals`,
              }
            : null,
        columns: buildColumns(items, tracked, totals.totalTime, false),
        bottleneck: tracked ? buildBottleneck(items, totals.totalTime) : null,
        finished: false,
    };
}

function buildFromSnapshot(snapshot: CraftDetailSnapshot): CraftDetailView {
    const { items, hasTrackingInfo: tracked, elapsedMs } = snapshot;
    const totals = craftTotals(items);
    const jobRate = tracked && elapsedMs > 0 ? totals.crafted / (elapsedMs / 1000) : 0;

    const stats: CraftDetailStat[] = [{ label: "Took", value: tracked ? formatDuration(elapsedMs) : "—" }];
    if (tracked) stats.push({ label: "Crafts / sec", value: jobRate.toFixed(2) });

    return {
        outputName: snapshot.output.itemname,
        outputQty: snapshot.output.quantity,
        subtitle: `${snapshot.cpuName} - ${snapshot.coProcessors} co-proc${snapshot.coProcessors === 1 ? "" : "s"} - ${storageStat(snapshot.usedStorage, snapshot.availableStorage)}`,
        statusLabel: "Completed",
        statusVariant: "green",
        stats,
        progress: tracked
            ? {
                  fraction: 1,
                  caption: `Completed - ${formatNumber(totals.crafted)} sub-crafts recorded over ${formatDuration(elapsedMs)}`,
              }
            : null,
        columns: buildColumns(items, tracked, totals.totalTime, true),
        bottleneck: tracked ? buildBottleneck(items, totals.totalTime) : null,
        finished: true,
    };
}

function buildColumns(
    items: CompactedItem[],
    tracked: boolean,
    totalTime: number,
    finished: boolean,
): CraftDetailColumn[] {
    const crafting = finished ? [] : items.filter((i) => i.active > 0);
    const waiting = finished ? [] : items.filter((i) => i.active === 0 && i.pending > 0);
    const done = finished ? items : items.filter((i) => i.active === 0 && i.pending === 0 && i.craftedTotal > 0);
    return [
        {
            key: "crafting",
            title: "Crafting",
            color: "amber",
            rows: crafting.map((i) => buildRow(i, tracked, "active", totalTime)),
            emptyText: "Nothing being crafted right now",
        },
        {
            key: "waiting",
            title: "Waiting",
            color: "grey",
            rows: waiting.map((i) => buildRow(i, tracked, "scheduled", totalTime)),
            emptyText: "Nothing scheduled",
        },
        {
            key: "done",
            title: "Done",
            color: "green",
            rows: done.map((i) => buildRow(i, tracked, "complete", totalTime)),
            emptyText: tracked ? "Nothing finished yet" : "Completion needs job tracking",
        },
    ];
}

function buildBottleneck(items: CompactedItem[], totalTime: number): CraftDetailBottleneckRow[] {
    return items
        .filter((i) => i.timeSpentCrafting > 0)
        .sort((a, b) => b.timeSpentCrafting - a.timeSpentCrafting)
        .slice(0, 5)
        .map((i) => {
            const share = totalTime > 0 ? i.timeSpentCrafting / totalTime : 0;
            return {
                itemname: i.itemname,
                sharePct: share,
                label: `${formatDuration(i.timeSpentCrafting)} - ${Math.round(share * 100)}%`,
            };
        });
}
