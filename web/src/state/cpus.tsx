import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getCpu, getCpuList } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { CpuDetail, CpuSummary, GridSummary } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { notify } from "../util/notify";
import type { GridSelection } from "./network";
import { useNetwork } from "./network";
import { usePrefs } from "./prefs";
import { useToast } from "./toast";

/**
 * A `CpuSummary` (`/list` entry) tagged with its source grid and, while `detailPolling` is on, the
 * latest `/get` detail plus a derived progress estimate.
 */
export interface CpuView extends CpuSummary {
    /** The map key from `/list` - see the name-instability caveat on `cpuKey` below. */
    name: string;
    /** The real grid key this row came from - never `"all"`, even in All-Grids mode. */
    sourceGridId: number;
    /** Owner-derived label for the source grid; only meaningful in All-Grids mode. */
    gridLabel: string;
    /** From `/get`, fetched only while `detailPolling` is on and only for busy CPUs. */
    detail: CpuDetail | null;
    /** 0-99, or null when there's nothing to derive a bar from (untracked, or no detail yet). */
    progressPct: number | null;
}

export interface CpusContextValue {
    cpus: CpuView[];
    busyCount: number;
    loading: boolean;
    error: string | null;
    /** Grid labels that failed during an All-Grids `/list` fan-out. */
    failedGrids: string[];
    /**
     * Fans the expensive per-busy-CPU `/get` in on top of `/list`. Callers gate this to when it's
     * actually shown (M2: the Jobs view) - never globally - per the server-thread drain budget
     * (`CoreEngine.DRAIN_BUDGET_NANOS`, `AE2Controller.requests`' 32-slot queue).
     */
    detailPolling: boolean;
    setDetailPolling: (enabled: boolean) => void;
    /** Suppresses the next busy->idle completion toast/notification for one CPU (a drawer-initiated cancel). */
    suppressCompletion: (gridId: number, cpuName: string) => void;
    refresh: () => Promise<void>;
}

const CpusContext = createContext<CpusContextValue | null>(null);

const SINGLE_GRID_INTERVAL_MS = 2500;
const ALL_GRIDS_INTERVAL_MS = 5000;

/** Opaque per-CPU identity for this poll cycle. Not stable long-term - see the comment on `computeTargets`. */
function cpuKey(gridId: number, name: string): string {
    return `${gridId} ${name}`;
}

function computeTargets(selection: GridSelection, allGrids: GridSummary[]): GridSummary[] {
    if (selection === "all") return allGrids.filter((g) => g.key !== -1);
    const grid = allGrids.find((g) => g.key === selection);
    return grid && grid.key !== -1 ? [grid] : [];
}

/**
 * `requested ~= craftedTotal + active + pending` per item (no real `requested` field exists - see
 * REDESIGN_MILESTONES.md caveat 1); progress = sum(crafted) / sum(requested). Clamped to [0, 99] so it
 * can never read 100% before the CPU actually reports idle (the risk logged at
 * REDESIGN_MILESTONES.md:297), and it can move non-monotonically since it's derived from crafted totals.
 */
function estimateProgress(detail: CpuDetail | null, hasTrackingInfo: boolean): number | null {
    if (!hasTrackingInfo || !detail?.items) return null;
    let crafted = 0;
    let requested = 0;
    for (const item of detail.items) {
        crafted += item.craftedTotal;
        requested += item.craftedTotal + item.active + item.pending;
    }
    if (requested <= 0) return null;
    return Math.min(99, Math.max(0, (crafted / requested) * 100));
}

interface LastBusyEntry {
    cpuName: string;
    itemname: string;
    quantity: number;
}

export function CpusProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected } = useNetwork();
    const { notifyEnabled } = usePrefs();
    const toast = useToast();

    const [cpus, setCpus] = useState<CpuView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [failedGrids, setFailedGrids] = useState<string[]>([]);
    const [detailPolling, setDetailPolling] = useState(false);

    // "Latest ref" mirrors of props/state the poll loop reads every cycle without needing to restart
    // the effect (and therefore the loop's timer/generation/completion-tracking) whenever they change.
    const gridsRef = useRef(grids);
    gridsRef.current = grids;
    const detailPollingRef = useRef(detailPolling);
    detailPollingRef.current = detailPolling;
    const notifyEnabledRef = useRef(notifyEnabled);
    notifyEnabledRef.current = notifyEnabled;

    const generationRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastBusyRef = useRef<Map<string, LastBusyEntry>>(new Map());
    const suppressRef = useRef<Set<string>>(new Set());
    const seededGenerationRef = useRef(-1);
    const runNowRef = useRef<() => Promise<void>>(async () => {});

    const suppressCompletion = useCallback((gridId: number, cpuName: string) => {
        suppressRef.current.add(cpuKey(gridId, cpuName));
    }, []);

    // Force one immediate cycle when detail polling turns on (Jobs view mounts), rather than waiting
    // out whatever's left of the current `/list`-only interval - otherwise a busy CPU's drawer can
    // show "No items on this CPU" for up to the poll interval after the view opens.
    useEffect(() => {
        if (detailPolling) void runNowRef.current();
    }, [detailPolling]);

    useEffect(() => {
        const generation = ++generationRef.current;
        lastBusyRef.current = new Map();
        seededGenerationRef.current = -1;
        setLoading(true);
        let stopped = false;
        const intervalMs = selected === "all" ? ALL_GRIDS_INTERVAL_MS : SINGLE_GRID_INTERVAL_MS;

        function detectCompletions(collected: CpuView[]) {
            const firstCycleOfGeneration = seededGenerationRef.current !== generation;
            const nextBusy = new Map<string, LastBusyEntry>();
            for (const cpu of collected) {
                if (cpu.isBusy && cpu.finalOutput) {
                    nextBusy.set(cpuKey(cpu.sourceGridId, cpu.name), {
                        cpuName: cpu.name,
                        itemname: cpu.finalOutput.itemname,
                        quantity: cpu.finalOutput.quantity,
                    });
                }
            }
            if (!firstCycleOfGeneration) {
                for (const [key, prev] of lastBusyRef.current) {
                    if (nextBusy.has(key)) continue; // still busy
                    // A key that disappeared entirely (not just gone idle) is a renumbered/removed
                    // cluster (GetCPUList.java's internalID is reassigned on every enumeration) - not
                    // a completion, so only fire for a key still present but now idle.
                    const stillPresent = collected.some((c) => cpuKey(c.sourceGridId, c.name) === key);
                    if (!stillPresent) continue;
                    const suppressed = suppressRef.current.delete(key);
                    if (!suppressed) {
                        const plainName = skipSpecialFormat(prev.itemname);
                        toast(`${plainName} finished crafting on ${prev.cpuName}`);
                        notify(
                            notifyEnabledRef.current,
                            `${plainName} finished crafting`,
                            `${prev.cpuName} completed ${prev.quantity}x ${plainName}`,
                        );
                    }
                }
            }
            lastBusyRef.current = nextBusy;
            seededGenerationRef.current = generation;
        }

        const runAndSchedule = async (): Promise<void> => {
            if (stopped || document.hidden) return;
            try {
                const targets = computeTargets(selected, gridsRef.current);
                if (targets.length === 0) {
                    if (generation === generationRef.current) {
                        setCpus([]);
                        setFailedGrids([]);
                        setError(null);
                        setLoading(false);
                    }
                } else {
                    const collected: CpuView[] = [];
                    const failed: string[] = [];
                    for (const grid of targets) {
                        if (generation !== generationRef.current) return;
                        try {
                            const list = await getCpuList(grid.key);
                            const label = gridOptionLabel(grid, gridsRef.current);
                            for (const [name, summary] of Object.entries(list)) {
                                collected.push({
                                    ...summary,
                                    name,
                                    sourceGridId: grid.key,
                                    gridLabel: label,
                                    detail: null,
                                    progressPct: null,
                                });
                            }
                        } catch {
                            failed.push(gridOptionLabel(grid, gridsRef.current));
                        }
                    }

                    if (detailPollingRef.current) {
                        // Sequential, not fanned out: `/get` is a server-thread task under a 5ms/tick
                        // drain budget (CoreEngine.DRAIN_BUDGET_NANOS) - see REDESIGN_MILESTONES.md caveat 2.
                        for (const cpu of collected) {
                            if (generation !== generationRef.current) return;
                            if (!cpu.isBusy) continue;
                            try {
                                const detail = await getCpu(cpu.sourceGridId, cpu.name);
                                cpu.detail = detail;
                                cpu.progressPct = estimateProgress(detail, cpu.hasTrackingInfo);
                            } catch {
                                // Transient: e.g. GetCPU.java's craftsPerSec can be a NaN right after a
                                // job starts, which throws server-side and drops the whole response
                                // (no error envelope at all) - keep this CPU without fresh detail this
                                // cycle rather than surfacing an error; the next cycle usually succeeds.
                            }
                        }
                    }

                    if (generation !== generationRef.current) return;
                    detectCompletions(collected);
                    setCpus(collected);
                    setFailedGrids(failed);
                    setError(null);
                    setLoading(false);
                }
            } catch (e) {
                if (generation === generationRef.current) {
                    setError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            }
            if (stopped || generation !== generationRef.current) return;
            timerRef.current = setTimeout(() => void runAndSchedule(), intervalMs);
        };

        const onVisibilityChange = () => {
            clearTimeout(timerRef.current);
            if (!document.hidden) void runAndSchedule();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        runNowRef.current = async () => {
            clearTimeout(timerRef.current);
            await runAndSchedule();
        };

        void runAndSchedule();

        return () => {
            stopped = true;
            clearTimeout(timerRef.current);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
        // `grids.length` (not `grids` itself) restarts the loop once the initial `/grids` fetch
        // resolves from empty, or a grid is added/removed - without restarting (and so resetting the
        // completion-tracking baseline and poll cadence) on every identity-only grids refresh.
    }, [selected, grids.length, toast]);

    const refresh = useCallback(() => runNowRef.current(), []);

    const busyCount = useMemo(() => cpus.filter((c) => c.isBusy).length, [cpus]);

    const value = useMemo<CpusContextValue>(
        () => ({
            cpus,
            busyCount,
            loading,
            error,
            failedGrids,
            detailPolling,
            setDetailPolling,
            suppressCompletion,
            refresh,
        }),
        [cpus, busyCount, loading, error, failedGrids, detailPolling, suppressCompletion, refresh],
    );

    return <CpusContext.Provider value={value}>{children}</CpusContext.Provider>;
}

export function useCpus(): CpusContextValue {
    const ctx = useContext(CpusContext);
    if (!ctx) throw new Error("useCpus must be used within a CpusProvider");
    return ctx;
}

export { cpuKey };
