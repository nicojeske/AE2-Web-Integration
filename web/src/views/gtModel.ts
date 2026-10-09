// Pure helpers shared by the GregTech hub views (Machines, Power, Production).
import { formatLiters, formatNumber } from "../api/format";
import type { GTMachine, GTMachines, GTMachineStatus, GTRange } from "../api/types";
import { GT_STATUS_ORDER } from "../api/types";
import type { BadgeVariant } from "../ui/Badge";
import type { SegmentedOption } from "../ui/SegmentedControl";
import type { MachineFilters, PassiveMachines } from "../state/prefs";

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
 * Recipe progress as of `now`: the scan's `progressTicks`, advanced by the wall time since the scan
 * (20 ticks/s) so a bar keeps moving between 10 s polls instead of jumping. Wraps past the recipe length
 * rather than clamping: a running machine nearly always starts the same recipe again, and short recipes
 * (a few seconds) would otherwise sit at 100% for most of every scan interval. The next scan corrects it
 * either way.
 */
export function liveProgressTicks(m: GTMachine, scannedAt: number, now: number): number {
    if (!m.loaded || m.status !== "RUNNING" || m.maxProgressTicks <= 0) return m.progressTicks;
    const elapsedTicks = Math.max(0, Math.floor((now - scannedAt) / 50));
    return (m.progressTicks + elapsedTicks) % m.maxProgressTicks;
}

/** Every whitespace-separated token must appear in name, type, coordinates, owner or dimension. */
export function matchesMachineSearch(m: GTMachine, search: string): boolean {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = [m.name, m.type, coordsText(m), `${m.x},${m.y},${m.z}`, m.ownerName ?? "", dimensionKey(m)]
        .join(" ")
        .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
}

export function filterMachines(machines: GTMachine[], filters: MachineFilters, search: string): GTMachine[] {
    return machines.filter(
        (m) =>
            (filters.showUnloaded || m.loaded) &&
            (filters.statuses.length === 0 || filters.statuses.includes(m.status)) &&
            (filters.dimension === null || dimensionKey(m) === filters.dimension) &&
            matchesMachineSearch(m, search),
    );
}

export interface MachineGroup {
    /** A status, `"passive"` for healthy machines marked passive, or `"unloaded"` for the final "Not loaded" group. */
    key: GTMachineStatus | "passive" | "unloaded";
    label: string;
    machines: GTMachine[];
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
        machines: machines.filter(
            (m) => m.loaded && m.status === status && !isTuckedPassive(m, passive, passiveProblems),
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

/** The server's passive suggestions the user hasn't marked or dismissed yet, in list order. */
export function pendingPassiveSuggestions(data: GTMachines, passive: PassiveMachines): GTMachine[] {
    const suggested = new Set(data.suggestedPassive ?? []);
    return data.machines.filter((m) => suggested.has(m.id) && !(m.id in passive));
}
