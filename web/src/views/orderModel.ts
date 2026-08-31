// Pure view-model helpers for the order modal and plan-mode Craft Detail (M4). No Preact here, mirroring
// craftDetailModel.ts - the CPU validity rule and the plan bucketing are reviewable/testable in isolation.
import { formatBytes, formatNumber } from "../api/format";
import type { JobData, JobPlanItem } from "../api/types";
import type { CraftDetailColumn, CraftDetailItemRow, CraftDetailStat } from "./craftDetailModel";
import type { BadgeVariant } from "../ui/Badge";

/** Structural subset of `CpuView`/`CpuSummary` this module needs - kept local (not imported from
 *  `state/cpus`) so this stays a leaf module with no dependency on the polling state. */
export interface CpuLike {
    name: string;
    isBusy: boolean;
    finalOutput: { itemid: string } | null;
    availableStorage: number;
    usedStorage: number;
    coProcessors: number;
}

export type OrderCpuState = "invalid" | "mergeable" | "idle";

export interface OrderCpuRow {
    name: string;
    state: OrderCpuState;
    selected: boolean;
    selectable: boolean;
    tag: string;
    detail: string;
}

/**
 * Ported from the old `webpage.html:1161` `isValidCPUForOrder`, with the merge-identity check moved from
 * `finalOutput.hashcode` to `finalOutput.itemid` - see REDESIGN_MILESTONES.md's M4 deviation log for why
 * (a modern-branch `GenericStack` hashcode includes stack size, so a hashcode compare could never match).
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

function storageDetail(cpu: CpuLike): string {
    const used = cpu.usedStorage === -1 ? "—" : formatBytes(cpu.usedStorage);
    return cpu.isBusy
        ? `${used} / ${formatBytes(cpu.availableStorage)} - ${cpu.coProcessors} co-proc${cpu.coProcessors === 1 ? "" : "s"}`
        : `${formatBytes(cpu.availableStorage)} - ${cpu.coProcessors} co-proc${cpu.coProcessors === 1 ? "" : "s"}`;
}

export function cpuRow(
    cpu: CpuLike,
    bytesTotal: number,
    outputItemid: string,
    selectedName: string | null,
): OrderCpuRow {
    const valid = isValidCpuForPlan(cpu, bytesTotal, outputItemid);
    const state = cpuState(cpu, valid);
    return {
        name: cpu.name,
        state,
        selected: valid && selectedName === cpu.name,
        selectable: valid,
        tag: state === "invalid" ? "Not enough storage" : state === "mergeable" ? "Merge into job" : "Idle",
        detail: storageDetail(cpu),
    };
}

/** First valid CPU in list order, mirroring `webpage.html:1177-1181`'s `updateCPUListForJob` - it takes
 *  whichever comes first (merge or idle), not the smallest or fastest fit. */
export function pickDefaultCpu(cpus: CpuLike[], bytesTotal: number, outputItemid: string): string | null {
    for (const cpu of cpus) {
        if (isValidCpuForPlan(cpu, bytesTotal, outputItemid)) return cpu.name;
    }
    return null;
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
    const missing = plan.filter((r) => r.missing > 0);
    const toCraft = plan.filter((r) => r.missing === 0 && r.requested > 0);
    const fromStorage = plan.filter((r) => r.missing === 0 && r.requested === 0 && r.stored > 0);
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
