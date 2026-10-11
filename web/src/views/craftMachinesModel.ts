// Ties a running craft's pattern providers ("Working machines") to the GregTech machines doing the work.
// AE2 only knows which provider holds a pushed pattern; GregTech only knows what each multiblock is
// running. They meet on the recipe: a machine whose running recipe outputs something a provider still
// owes the job is working for it. One provider can feed several machines (a Crafting Input Buffer with
// proxies, a shared input bus), so each provider gets a list. Purely client-side over `/gt/machines`.
import type { DimensionalCoords, GTMachine, GTMachines, WorkingMachine } from "../api/types";
import { GT_PROBLEM_STATUSES, GT_STATUS_ORDER } from "../api/types";
import type { PassiveMachines } from "../state/prefs";
import { GT_STATUS_VARIANTS, liveProgressTicks } from "./gtModel";

/** Each provider group's machines, problems first, then soonest to finish. Unmatched providers are absent. */
export type MachineMatches = Map<WorkingMachine, GTMachine[]>;

/**
 * Loaded, non-passive machines whose running recipe outputs one of a provider's owed items. A machine
 * two providers both match goes to the one with the nearest location (same dimension first; a provider
 * named like the machine wins a tie), so it's listed once. No distance cap: proxies and P2P put the
 * provider anywhere, and `/gt/machines` already only lists the player's own or team's machines.
 */
export function matchGTMachines(
    providers: WorkingMachine[],
    gt: GTMachines | null,
    passive: PassiveMachines,
): MachineMatches {
    const matches: MachineMatches = new Map();
    if (!gt || providers.length === 0) return matches;
    const owed = providers.map((p) => new Set(p.items.map((i) => i.itemid)));

    for (const m of gt.machines) {
        if (!m.loaded || passive[m.id] === true || m.outputs.length === 0) continue;
        let best: { provider: WorkingMachine; distance: number; nameMatch: boolean } | null = null;
        providers.forEach((provider, i) => {
            if (!m.outputs.some((o) => owed[i]!.has(o.id))) return;
            const distance = nearestDistance(m, provider.location);
            const nameMatch = provider.name === m.name;
            if (!best || distance < best.distance || (distance === best.distance && nameMatch && !best.nameMatch)) {
                best = { provider, distance, nameMatch };
            }
        });
        if (!best) continue;
        const { provider } = best;
        const list = matches.get(provider);
        if (list) list.push(m);
        else matches.set(provider, [m]);
    }

    const statusIndex = (m: GTMachine) => GT_STATUS_ORDER.indexOf(m.status);
    const problemRank = (m: GTMachine) => (GT_PROBLEM_STATUSES.has(m.status) ? 0 : 1);
    const remaining = (m: GTMachine) => (m.maxProgressTicks > 0 ? m.maxProgressTicks - m.progressTicks : Infinity);
    for (const list of matches.values()) {
        list.sort(
            (a, b) =>
                problemRank(a) - problemRank(b) ||
                statusIndex(a) - statusIndex(b) ||
                remaining(a) - remaining(b) ||
                a.id.localeCompare(b.id),
        );
    }
    return matches;
}

/** Blocks from the controller to the closest provider location; another dimension counts as infinitely far. */
function nearestDistance(m: GTMachine, locations: DimensionalCoords[]): number {
    let best = Infinity;
    for (const loc of locations) {
        if (loc.dimid !== String(m.dim)) continue;
        best = Math.min(best, Math.hypot(loc.x - m.x, loc.y - m.y, loc.z - m.z));
    }
    return best;
}

export interface MachineGroupSummary {
    running: number;
    total: number;
    /** Seconds until the soonest running recipe finishes; `null` when none is running. */
    nextSeconds: number | null;
    /** Any machine in a `GT_PROBLEM_STATUSES` status - colours the provider card. */
    problem: "red" | "amber" | null;
}

export function summarizeMachines(machines: GTMachine[], scannedAt: number, now: number): MachineGroupSummary {
    let running = 0;
    let nextTicks: number | null = null;
    let problem: MachineGroupSummary["problem"] = null;
    for (const m of machines) {
        if (m.status === "RUNNING") {
            running++;
            if (m.maxProgressTicks > 0) {
                const left = m.maxProgressTicks - liveProgressTicks(m, scannedAt, now);
                nextTicks = nextTicks === null ? left : Math.min(nextTicks, left);
            }
        } else if (GT_PROBLEM_STATUSES.has(m.status)) {
            const variant = GT_STATUS_VARIANTS[m.status];
            if (variant === "red") problem = "red";
            else if (variant === "amber" && problem === null) problem = "amber";
        }
    }
    return {
        running,
        total: machines.length,
        nextSeconds: nextTicks === null ? null : Math.max(0, Math.ceil(nextTicks / 20)),
        problem,
    };
}

/** Which full pass of the recipe the live progress is on - a key that changes when the bar wraps to 0. */
export function progressCycle(m: GTMachine, scannedAt: number, now: number): number {
    if (m.status !== "RUNNING" || m.maxProgressTicks <= 0) return 0;
    const elapsedTicks = Math.max(0, Math.floor((now - scannedAt) / 50));
    return Math.floor((m.progressTicks + elapsedTicks) / m.maxProgressTicks);
}
