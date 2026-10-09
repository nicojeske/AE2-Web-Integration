// Pure view-model helpers for the order modal and plan-mode Craft Detail (M4). No Preact here, mirroring
// craftDetailModel.ts - the CPU validity rule and the plan bucketing are reviewable/testable in isolation.
import { formatBytes, formatNumber } from "../api/format";
import type { JobData, JobPlanItem } from "../api/types";
import type { CraftDetailColumn, CraftDetailItemRow, CraftDetailStat } from "./craftDetailModel";
import type { BadgeVariant } from "../ui/Badge";

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
    fromStorage: JobPlanItem[];
}

export function bucketPlan(job: JobData): PlanBuckets {
    const plan = job.plan ?? [];
    return {
        missing: plan.filter((r) => r.missing > 0),
        toCraft: plan.filter((r) => r.missing === 0 && r.requested > 0),
        fromStorage: plan.filter((r) => r.missing === 0 && r.requested === 0 && r.stored > 0),
    };
}

export interface PlanDetailView {
    statusLabel: "Ready" | "Simulation";
    statusVariant: BadgeVariant;
    /** Bytes / Craft steps / Missing items - Output is rendered separately (needs `<FormattedText>`). */
    stats: CraftDetailStat[];
    columns: CraftDetailColumn[];
    bytesTotal: number;
    missingCount: number;
}

function planRow(item: JobPlanItem, badgeText: string): CraftDetailItemRow {
    return {
        itemid: item.itemid,
        itemname: item.itemname,
        badgeText,
        stats: [
            { label: "requested", value: formatNumber(item.requested) },
            { label: "from storage", value: formatNumber(item.stored) },
            { label: "missing", value: formatNumber(item.missing) },
            { label: "steps", value: formatNumber(item.steps) },
        ],
        sharePct: item.usedPercent > 0 ? item.usedPercent : null,
        shareCaption: "of stock",
    };
}

/**
 * Builds the plan-mode Craft Detail view model from a completed `/job?id=` response. Bucketed exactly as
 * `Job.java` fills the fields (caveat: `missing`/`requested`/`stored` are mutually exclusive per row
 * there, see `Job.java:106-121`), not by re-deriving from `Job.java`'s own sort order.
 */
export function buildPlanDetail(job: JobData): PlanDetailView {
    const plan = job.plan ?? [];
    const { missing, toCraft, fromStorage } = bucketPlan(job);
    const steps = plan.reduce((sum, r) => sum + r.steps, 0);

    const columns: CraftDetailColumn[] = [
        {
            key: "crafting", // reusing craftDetailModel's key union loosely - title/color drive the render
            title: "Missing",
            color: "red",
            rows: missing.map((r) => planRow(r, "unavailable")),
            emptyText: "Nothing missing",
        },
        {
            key: "waiting",
            title: "To craft",
            color: "purple",
            rows: toCraft.map((r) => planRow(r, "craft")),
            emptyText: "Nothing to craft",
        },
        {
            key: "done",
            title: "From storage",
            color: "teal",
            rows: fromStorage.map((r) => planRow(r, "in stock")),
            emptyText: "Nothing taken from storage",
        },
    ];

    return {
        statusLabel: job.isSimulating ? "Simulation" : "Ready",
        statusVariant: job.isSimulating ? "red" : "green",
        stats: [
            { label: "Bytes", value: formatBytes(job.bytesTotal) },
            { label: "Craft steps", value: formatNumber(steps) },
            { label: "Missing items", value: formatNumber(missing.length) },
        ],
        columns,
        bytesTotal: job.bytesTotal,
        missingCount: missing.length,
    };
}
