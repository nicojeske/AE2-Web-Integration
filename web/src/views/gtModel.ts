// Pure helpers shared by the GregTech hub views (Machines, Power, Production).
import { formatLiters, formatNumber } from "../api/format";
import type { GTMachine, GTMachines, GTMachineStatus, GTProductionEntry, GTRange } from "../api/types";
import { GT_PROBLEM_STATUSES, GT_STATUS_ORDER } from "../api/types";
import type { BadgeVariant } from "../ui/Badge";
import type { SegmentedOption } from "../ui/SegmentedControl";
import type { MachineFilters, MachineLabels, PassiveMachines } from "../state/prefs";

export const GT_STATUS_LABELS: Record<GTMachineStatus, string> = {
    STRUCTURE_INCOMPLETE: "Structure incomplete",
    MAINTENANCE: "Maintenance",
    NO_POWER: "No power",
    OUTPUT_FULL: "Output full",
    STOPPED: "Stopped",
    DISABLED: "Disabled",
    IDLE: "Idle",
    RUNNING: "Running",
};

/** Hard faults red, recoverable-by-itself amber, deliberate states grey, idle neutral, running green. */
export const GT_STATUS_VARIANTS: Record<GTMachineStatus, BadgeVariant> = {
    STRUCTURE_INCOMPLETE: "red",
    MAINTENANCE: "amber",
    NO_POWER: "red",
    OUTPUT_FULL: "amber",
    STOPPED: "red",
    DISABLED: "grey",
    IDLE: "purple",
    RUNNING: "green",
};

/** Range presets for GT history views - Statistics' set with `1y` swapped for `90d` (the GT retention). */
export const GT_RANGE_OPTIONS: SegmentedOption<GTRange>[] = [
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "6h", label: "6h" },
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
    { value: "custom", label: "Custom" },
];

export function gtRangeOptions(values: GTRange[]): SegmentedOption<GTRange>[] {
    return GT_RANGE_OPTIONS.filter((o) => values.includes(o.value));
}

/** An item count, or a fluid amount in L/kL/ML. */
export function formatGTAmount(amount: number, fluid: boolean, mode: "full" | "compact"): string {
    return fluid ? formatLiters(amount, mode) : formatNumber(amount, mode);
}

/** A `/h` rate - one decimal below 10 so a slow-but-real rate doesn't round to 0. */
export function formatGTPerHour(perHour: number, fluid: boolean, mode: "full" | "compact"): string {
    const v = perHour < 10 ? Math.round(perHour * 10) / 10 : Math.round(perHour);
    return formatGTAmount(v, fluid, mode);
}

/** `"12 µs"` / `"1.4 ms"` - the server's scan cost. */
export function formatMicros(micros: number): string {
    return micros < 1000 ? `${micros} µs` : `${(micros / 1000).toFixed(1)} ms`;
}

/** The dimension filter's key for a machine - `dimName`, or `"dim <n>"` when the server sent none. */
export function dimensionKey(m: Pick<GTMachine, "dim" | "dimName">): string {
    return m.dimName ?? `dim ${m.dim}`;
}

export function coordsText(m: Pick<GTMachine, "x" | "y" | "z">): string {
    return `${m.x} ${m.y} ${m.z}`;
}

/**
 * A running recipe's timing, for showing its progress between 10 s polls: one pass takes `cycleMs`, and a pass
 * began at wall time `epoch` (the scan's `progressTicks` back from `scannedAt`, 20 ticks/s). Progress wraps past
 * the recipe length rather than clamping: a running machine nearly always starts the same recipe again, and short
 * recipes (a few seconds) would otherwise sit at 100% for most of every poll. The next scan corrects it either way.
 * `null` unless the machine is loaded and running.
 */
export interface RecipeClock {
    cycleMs: number;
    epoch: number;
}

export function recipeClock(m: GTMachine, scannedAt: number): RecipeClock | null {
    if (!m.loaded || m.status !== "RUNNING" || m.maxProgressTicks <= 0) return null;
    return { cycleMs: m.maxProgressTicks * 50, epoch: scannedAt - m.progressTicks * 50 };
}

/** Milliseconds into the current pass at `now`. */
export function clockProgressMs(c: RecipeClock, now: number): number {
    return (((now - c.epoch) % c.cycleMs) + c.cycleMs) % c.cycleMs;
}

/** Milliseconds until the current pass finishes. */
export function clockRemainingMs(c: RecipeClock, now: number): number {
    return c.cycleMs - clockProgressMs(c, now);
}

/** `"12s"` / `"3m 4s"`. */
export function formatSecondsLeft(remainingMs: number): string {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

/**
 * How long the machine has been in its status, `"14m"` / `"2h 13m"` / `"3d 4h"` - only for problems and
 * idling, where the duration is the point; null for running/disabled machines or an unknown start.
 */
export function statusDuration(m: GTMachine, now: number): string | null {
    if (m.statusSinceMillis <= 0 || (!GT_PROBLEM_STATUSES.has(m.status) && m.status !== "IDLE")) return null;
    const minutes = Math.floor(Math.max(0, now - m.statusSinceMillis) / 60_000);
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The user's nicknames and processing lines for GT machines (`state/prefs.tsx`). */
export interface MachineNaming {
    names: MachineLabels;
    lines: MachineLabels;
}

/** The machine's nickname, or its GregTech name. */
export function machineLabel(m: Pick<GTMachine, "id" | "name">, names: MachineLabels): string {
    return names[m.id] ?? m.name;
}

/**
 * Every whitespace-separated token must appear in name, nickname, line, type, coordinates, owner, dimension or
 * the running recipe's inputs and outputs ("which machine makes Polyethylene?").
 */
export function matchesMachineSearch(m: GTMachine, search: string, naming?: MachineNaming): boolean {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = [
        m.name,
        naming?.names[m.id] ?? "",
        naming?.lines[m.id] ?? "",
        m.type,
        coordsText(m),
        `${m.x},${m.y},${m.z}`,
        m.ownerName ?? "",
        dimensionKey(m),
        ...m.outputs.map((s) => s.name),
        ...m.inputs.map((s) => s.name),
    ]
        .join(" ")
        .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
}

export function filterMachines(
    machines: GTMachine[],
    filters: MachineFilters,
    search: string,
    naming?: MachineNaming,
): GTMachine[] {
    return machines.filter(
        (m) =>
            (filters.showUnloaded || m.loaded) &&
            (filters.statuses.length === 0 || filters.statuses.includes(m.status)) &&
            (filters.dimension === null || dimensionKey(m) === filters.dimension) &&
            matchesMachineSearch(m, search, naming),
    );
}

export interface MachineGroup {
    /**
     * A status, `"passive"` for healthy machines marked passive, `"unloaded"` for the final "Not loaded" group;
     * in line grouping `"line:<name>"` per processing line and `"unassigned"`.
     */
    key: string;
    label: string;
    machines: GTMachine[];
    /** Line groups only: the processing line's name, for renaming. */
    line?: string;
    /** Line groups only. */
    health?: LineHealth;
}

export interface LineHealth {
    /** The most urgent status among the loaded members (`GT_STATUS_ORDER`); null when none is loaded. */
    worst: GTMachineStatus | null;
    /** Loaded members per status, in `GT_STATUS_ORDER`, zero counts left out. */
    counts: [GTMachineStatus, number][];
    /** Summed over loaded members; negative = the line generates more than it draws. */
    euPerTick: number;
}

export function lineHealth(machines: GTMachine[]): LineHealth {
    const loaded = machines.filter((m) => m.loaded);
    const counts = GT_STATUS_ORDER.map((s): [GTMachineStatus, number] => [
        s,
        loaded.filter((m) => m.status === s).length,
    ]).filter(([, n]) => n > 0);
    return {
        worst: counts[0]?.[0] ?? null,
        counts,
        euPerTick: loaded.reduce((sum, m) => sum + m.euPerTick, 0),
    };
}

const statusRank = (m: GTMachine) => (m.loaded ? GT_STATUS_ORDER.indexOf(m.status) : GT_STATUS_ORDER.length);

/**
 * One group per processing line, alphabetical, members by status (unloaded last) then label; then every
 * machine on no line as "Unassigned". Passive marks don't apply here - putting a machine on a line is
 * already the user saying where it belongs.
 */
export function groupMachinesByLine(machines: GTMachine[], naming: MachineNaming): MachineGroup[] {
    const byLine = new Map<string, GTMachine[]>();
    const unassigned: GTMachine[] = [];
    for (const m of machines) {
        const line = naming.lines[m.id];
        if (line === undefined) unassigned.push(m);
        else byLine.set(line, [...(byLine.get(line) ?? []), m]);
    }
    const order = (list: GTMachine[]) =>
        [...list].sort(
            (a, b) =>
                statusRank(a) - statusRank(b) ||
                machineLabel(a, naming.names).localeCompare(machineLabel(b, naming.names)),
        );
    const groups: MachineGroup[] = [...byLine.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((line) => {
            const members = order(byLine.get(line)!);
            return { key: `line:${line}`, label: line, line, machines: members, health: lineHealth(members) };
        });
    if (unassigned.length > 0) groups.push({ key: "unassigned", label: "Unassigned", machines: order(unassigned) });
    return groups;
}

/** Every processing line name in use, alphabetical. */
export function lineNames(lines: MachineLabels): string[] {
    return [...new Set(Object.values(lines))].sort((a, b) => a.localeCompare(b));
}

/**
 * `/gt/production?groupBy=machine` rows summed per processing line: each line's breakdown merges its
 * machines' breakdowns by key. Machines on no line become one "Unassigned" row (key `""`), listed last.
 */
export function aggregateLines(rows: GTProductionEntry[], lines: MachineLabels): GTProductionEntry[] {
    const groups = new Map<string, Map<string, GTProductionEntry>>();
    for (const row of rows) {
        const line = lines[row.key] ?? "";
        let merged = groups.get(line);
        if (!merged) groups.set(line, (merged = new Map()));
        for (const b of row.breakdown) {
            const prev = merged.get(b.key);
            merged.set(
                b.key,
                prev ? { ...prev, total: prev.total + b.total, perHour: prev.perHour + b.perHour } : { ...b },
            );
        }
    }
    return [...groups.entries()]
        .map(([line, merged]): GTProductionEntry => {
            const breakdown = [...merged.values()].sort((a, b) => b.total - a.total);
            return {
                key: line,
                name: line === "" ? "Unassigned" : line,
                fluid: false,
                total: breakdown.reduce((n, b) => n + b.total, 0),
                perHour: breakdown.reduce((n, b) => n + b.perHour, 0),
                breakdown,
            };
        })
        .sort((a, b) => ((a.key === "") !== (b.key === "") ? (a.key === "" ? 1 : -1) : b.total - a.total));
}

/** Statuses a passive machine stays tucked away in; anything else is worth a look and shows normally. */
const PASSIVE_HEALTHY: ReadonlySet<GTMachineStatus> = new Set<GTMachineStatus>(["RUNNING", "IDLE"]);

/** With `passiveProblems` off, a passive machine stays tucked away whatever its status. */
export function isTuckedPassive(m: GTMachine, passive: PassiveMachines, passiveProblems = true): boolean {
    return m.loaded && passive[m.id] === true && (!passiveProblems || PASSIVE_HEALTHY.has(m.status));
}

/**
 * Loaded machines grouped by status in `GT_STATUS_ORDER` (problems first), then the healthy ones marked
 * passive (every passive one when `passiveProblems` is off), then every unloaded one.
 */
export function groupMachines(machines: GTMachine[], passive: PassiveMachines, passiveProblems = true): MachineGroup[] {
    const groups: MachineGroup[] = GT_STATUS_ORDER.map((status) => ({
        key: status,
        label: GT_STATUS_LABELS[status],
        machines: sortProblemsLongestFirst(
            machines.filter((m) => m.loaded && m.status === status && !isTuckedPassive(m, passive, passiveProblems)),
        ),
    }));
    groups.push({
        key: "passive",
        label: "Passive",
        machines: machines.filter((m) => isTuckedPassive(m, passive, passiveProblems)),
    });
    groups.push({ key: "unloaded", label: "Not loaded", machines: machines.filter((m) => !m.loaded) });
    return groups.filter((g) => g.machines.length > 0);
}

/** Machines in a problem status, the one stuck longest first (it has likely cost the most); others as given. */
function sortProblemsLongestFirst(machines: GTMachine[]): GTMachine[] {
    if (machines.length === 0 || !GT_PROBLEM_STATUSES.has(machines[0]!.status)) return machines;
    return [...machines].sort((a, b) => (a.statusSinceMillis || Infinity) - (b.statusSinceMillis || Infinity));
}

/** The server's passive suggestions the user hasn't marked or dismissed yet, in list order. */
export function pendingPassiveSuggestions(data: GTMachines, passive: PassiveMachines): GTMachine[] {
    const suggested = new Set(data.suggestedPassive ?? []);
    return data.machines.filter((m) => suggested.has(m.id) && !(m.id in passive));
}
