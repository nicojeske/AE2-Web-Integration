// Pure view-model helpers for the order modal and the plan preview. No Preact here, mirroring
// craftDetailModel.ts - the CPU ranking, the plan table and the duration estimate stay testable in isolation.
import { formatBytes, formatDuration, skipSpecialFormat } from "../api/format";
import type { JobData, JobPlanItem, TrackingHistoryElement } from "../api/types";

/** Structural subset of `CpuView`/`CpuSummary` this module needs - kept local (not imported from
 *  `state/cpus`) so this stays a leaf module with no dependency on the polling state. */
export interface CpuLike {
    /** Address for submitting; `name` is only shown. */
    cpuKey: string;
    name: string;
    isBusy: boolean;
    finalOutput: { itemid: string } | null;
    availableStorage: number;
    usedStorage: number;
    coProcessors: number;
}

export type OrderCpuState = "invalid" | "mergeable" | "idle";

export interface OrderCpuRow {
    cpuKey: string;
    name: string;
    state: OrderCpuState;
    selected: boolean;
    selectable: boolean;
    tag: string;
    detail: string;
}

/**
 * Ported from the old `webpage.html:1161` `isValidCPUForOrder`, with the merge-identity check done on
 * `finalOutput.itemid`.
 */
export function isValidCpuForPlan(cpu: CpuLike, bytesTotal: number, outputItemid: string): boolean {
    if (!cpu.isBusy) return cpu.availableStorage >= bytesTotal;
    if (!cpu.finalOutput) return false;
    if (cpu.finalOutput.itemid !== outputItemid) return false;
    if (cpu.usedStorage === -1) return false; // "not reported" - unmeasurable, never offered as a merge target
    return cpu.availableStorage >= cpu.usedStorage + bytesTotal;
}

function cpuState(cpu: CpuLike, valid: boolean): OrderCpuState {
    if (!valid) return "invalid";
    return cpu.isBusy ? "mergeable" : "idle";
}

/** Why a CPU can't take this plan - the tag on its disabled row. */
function invalidReason(cpu: CpuLike, bytesTotal: number, outputItemid: string): string {
    if (!cpu.isBusy) return `Needs ${formatBytes(bytesTotal - cpu.availableStorage)} more`;
    if (cpu.finalOutput?.itemid !== outputItemid) return "Busy with another item";
    if (cpu.usedStorage === -1) return "Busy";
    return `Needs ${formatBytes(cpu.usedStorage + bytesTotal - cpu.availableStorage)} more to merge`;
}

function storageDetail(cpu: CpuLike): string {
    const used = cpu.usedStorage === -1 ? "—" : formatBytes(cpu.usedStorage);
    return cpu.isBusy
        ? `${used} / ${formatBytes(cpu.availableStorage)} - ${cpu.coProcessors} co-proc${cpu.coProcessors === 1 ? "" : "s"}`
        : `${formatBytes(cpu.availableStorage)} - ${cpu.coProcessors} co-proc${cpu.coProcessors === 1 ? "" : "s"}`;
}

function cpuRow(cpu: CpuLike, bytesTotal: number, outputItemid: string, selectedKey: string | null): OrderCpuRow {
    const valid = isValidCpuForPlan(cpu, bytesTotal, outputItemid);
    const state = cpuState(cpu, valid);
    return {
        cpuKey: cpu.cpuKey,
        name: cpu.name,
        state,
        selected: valid && selectedKey === cpu.cpuKey,
        selectable: valid,
        tag:
            state === "invalid"
                ? invalidReason(cpu, bytesTotal, outputItemid)
                : state === "mergeable"
                  ? "Merge into job"
                  : "Idle",
        detail: storageDetail(cpu),
    };
}

/** CPU rows for the picker, in the order `pickDefaultCpu` ranks them, unusable ones last. */
export function cpuRows(
    cpus: CpuLike[],
    bytesTotal: number,
    outputItemid: string,
    selectedKey: string | null,
): OrderCpuRow[] {
    const rank = (c: CpuLike) => cpuRank(c, bytesTotal, outputItemid);
    return [...cpus]
        .sort((a, b) => compareRank(rank(a), rank(b)))
        .map((c) => cpuRow(c, bytesTotal, outputItemid, selectedKey));
}

/** `[group, -coProcessors, availableStorage]`: idle before merge before unusable, then the CPU that
 *  crafts fastest, then the tightest fit so the big CPUs stay free for big jobs. */
function cpuRank(cpu: CpuLike, bytesTotal: number, outputItemid: string): number[] {
    const group = !isValidCpuForPlan(cpu, bytesTotal, outputItemid) ? 2 : cpu.isBusy ? 1 : 0;
    return [group, -cpu.coProcessors, cpu.availableStorage];
}

function compareRank(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) {
        const d = a[i]! - b[i]!;
        if (d !== 0) return d;
    }
    return 0;
}

/** The best usable CPU (see `cpuRank`), or `null` when none can take the plan. Merging into a busy CPU
 *  is only picked when no idle one fits - an idle CPU runs the job in parallel instead of after. */
export function pickDefaultCpu(cpus: CpuLike[], bytesTotal: number, outputItemid: string): string | null {
    const best = cpuRows(cpus, bytesTotal, outputItemid, null)[0];
    return best?.selectable ? best.cpuKey : null;
}

/**
 * Integer, `>= 1`, clamped to `Number.MAX_SAFE_INTEGER` - the order `long` on the server has no smaller
 * ceiling, but a JS `Number` can't hold an exact integer past that point (same guard as the old
 * `webpage.html:1560`, ported here instead of a `window.prompt` numeric-string check).
 */
export function clampQuantity(raw: number): number {
    if (!Number.isFinite(raw)) return 1;
    const truncated = Math.trunc(raw);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, truncated));
}

export interface PlanBuckets {
    /** Rows AE2 couldn't source, most missing first (the server's own order). */
    missing: JobPlanItem[];
    toCraft: JobPlanItem[];
    /** Every row that takes something from storage - overlaps `toCraft` where AE2 both takes and
     *  crafts the same resource, and `missing` for what a simulation could partly source. */
    fromStorage: JobPlanItem[];
}

export function bucketPlan(job: JobData): PlanBuckets {
    const plan = job.plan ?? [];
    return {
        missing: plan.filter((r) => r.missing > 0),
        toCraft: plan.filter((r) => r.requested > 0),
        fromStorage: plan.filter((r) => r.stored > 0),
    };
}

export type PlanFilter = "all" | "missing" | "craft" | "storage";
export type PlanSortKey = "default" | "name" | "stored" | "requested" | "missing" | "steps";

export interface PlanQuery {
    filter: PlanFilter;
    /** Matched against the plain (§-stripped) name and the itemid, case-insensitive. */
    search: string;
    sortKey: PlanSortKey;
    descending: boolean;
}

function matchesFilter(row: JobPlanItem, filter: PlanFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "missing":
            return row.missing > 0;
        case "craft":
            return row.requested > 0;
        case "storage":
            return row.stored > 0;
    }
}

/**
 * The plan table's rows. Missing rows always stay on top - they are why a plan can't start - and the
 * chosen sort applies within each group; `default` keeps the server's order (missing, then crafts by
 * steps, then storage by amount).
 */
export function planTableRows(job: JobData, query: PlanQuery): JobPlanItem[] {
    const needle = query.search.trim().toLowerCase();
    const rows = (job.plan ?? []).filter(
        (r) =>
            matchesFilter(r, query.filter) &&
            (needle === "" ||
                skipSpecialFormat(r.itemname).toLowerCase().includes(needle) ||
                r.itemid.toLowerCase().includes(needle)),
    );
    if (query.sortKey === "default") return rows;
    const key = query.sortKey;
    const dir = query.descending ? -1 : 1;
    const compare = (a: JobPlanItem, b: JobPlanItem) =>
        key === "name"
            ? dir * skipSpecialFormat(a.itemname).localeCompare(skipSpecialFormat(b.itemname))
            : dir * (a[key] - b[key]);
    return rows.sort((a, b) => Number(b.missing > 0) - Number(a.missing > 0) || compare(a, b));
}

export interface DurationEstimate {
    ms: number;
    runs: number;
}

/** Past runs an estimate is drawn from, newest first. */
const ESTIMATE_RUNS = 5;

/**
 * How long crafting `quantity` of an item should take: the median time per unit of the latest finished
 * (not cancelled) runs of the same output on the same grid, scaled to `quantity`. Crafting time isn't
 * linear in quantity (setup, parallel machines), so it is shown as a rough "≈". `null` without a run.
 */
export function estimateDuration(
    history: TrackingHistoryElement[],
    itemid: string,
    quantity: number,
): DurationEstimate | null {
    const perUnit = history
        .filter((h) => !h.wasCancelled && h.finalOutput.itemid === itemid && h.finalOutput.quantity > 0)
        .sort((a, b) => b.timeDone - a.timeDone)
        .slice(0, ESTIMATE_RUNS)
        .map((h) => (h.timeDone - h.timeStarted) / h.finalOutput.quantity)
        .sort((a, b) => a - b);
    if (perUnit.length === 0) return null;
    const mid = perUnit.length >> 1;
    const median = perUnit.length % 2 ? perUnit[mid]! : (perUnit[mid - 1]! + perUnit[mid]!) / 2;
    return { ms: median * quantity, runs: perUnit.length };
}

export function formatEstimate(estimate: DurationEstimate): string {
    return `≈ ${formatDuration(estimate.ms)} (${estimate.runs} past run${estimate.runs === 1 ? "" : "s"})`;
}
