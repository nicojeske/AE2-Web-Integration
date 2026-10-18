// Pure helpers for the Bottlenecks section: range options, previous-period deltas, and the verdicts the
// GregTech machine-state table shows.
import { formatDuration } from "../api/format";
import type { BottleneckMachine, BottleneckRange, GTMachineStates, GTMachineStatus, GTRange } from "../api/types";
import { GT_STATUS_ORDER } from "../api/types";
import type { BadgeVariant } from "../ui/Badge";
import type { SegmentedOption } from "../ui/SegmentedControl";

export const BOTTLENECK_RANGES: SegmentedOption<BottleneckRange>[] = [
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
    { value: "1y", label: "1y" },
    { value: "all", label: "All" },
    { value: "custom", label: "Custom" },
];

/** Default span (minutes) the range control switches to when first landing on "custom": three days. */
export const DEFAULT_BOTTLENECK_CUSTOM_MINUTES = 3 * 24 * 60;

/** The GT endpoints have no `1y`; a year goes as a custom span instead. */
export function toGTRange(range: BottleneckRange, customMinutes: number): { range: GTRange; minutes?: number } {
    if (range === "1y") return { range: "custom", minutes: 365 * 24 * 60 };
    if (range === "custom") return { range: "custom", minutes: customMinutes };
    return { range };
}

export type MachineSort = "held" | "queued" | "busy";

export function sortMachines(machines: BottleneckMachine[], by: MachineSort): BottleneckMachine[] {
    const key = (m: BottleneckMachine) =>
        by === "held" ? m.heldMillis : by === "queued" ? m.queuedMillis : m.busyMillis;
    return [...machines].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}

/** `"+1h 20m"` / `"−5m 00s"` against the previous period, or `null` when unchanged or nothing to compare. */
export function formatDelta(current: number, previous: number | undefined): string | null {
    if (previous === undefined) return null;
    const delta = current - previous;
    if (Math.abs(delta) < 1000) return null;
    return `${delta > 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}`;
}

/** A trend in hours per bucket, for the bar charts. */
export function toHours(millis: number[]): number[] {
    return millis.map((m) => m / 3_600_000);
}

export function trendTimestamps(trendFrom: number, bucketMillis: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => trendFrom + i * bucketMillis);
}

export function describeBucket(bucketMillis: number): string {
    if (bucketMillis >= 7 * 86_400_000) return "week";
    if (bucketMillis >= 86_400_000) return "day";
    return "hour";
}

/** `/api/gt/machine-states` keys are the lower-case status names. */
export function stateMillis(machine: GTMachineStates, status: GTMachineStatus): number {
    return machine.states[status.toLowerCase()] ?? 0;
}

/** Statuses in the UI order, with each one's share of the observed time - for the stacked bar. */
export function stateShares(machine: GTMachineStates): { status: GTMachineStatus; share: number }[] {
    if (machine.observedMillis <= 0) return [];
    return GT_STATUS_ORDER.map((status) => ({
        status,
        share: stateMillis(machine, status) / machine.observedMillis,
    })).filter((s) => s.share > 0);
}

export interface MachineVerdict {
    label: string;
    variant: BadgeVariant;
    title: string;
}

/** What a machine's time split says, worst first: power, blocked output, maintenance, then running flat out. */
export function machineVerdicts(machine: GTMachineStates): MachineVerdict[] {
    const share = (s: GTMachineStatus) =>
        machine.observedMillis > 0 ? stateMillis(machine, s) / machine.observedMillis : 0;
    const verdicts: MachineVerdict[] = [];
    if (share("NO_POWER") >= 0.01) {
        verdicts.push({ label: "Power", variant: "red", title: "Was out of power for part of the range" });
    }
    if (share("OUTPUT_FULL") >= 0.05) {
        verdicts.push({
            label: "Output blocked",
            variant: "amber",
            title: "Stopped on full output often - whatever takes its output away can't keep up",
        });
    }
    if (share("MAINTENANCE") + share("STRUCTURE_INCOMPLETE") >= 0.05) {
        verdicts.push({ label: "Maintenance", variant: "amber", title: "Down for maintenance or a broken structure" });
    }
    if (machine.runningShare >= 0.9) {
        verdicts.push({
            label: "At capacity",
            variant: "purple",
            title: "Ran a recipe at least 90% of the time - a second one would add capacity",
        });
    }
    return verdicts;
}
