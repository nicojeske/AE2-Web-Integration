import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getCpu, getCpuList } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { CpuDetail, CpuSummary, GridKey, GridSummary } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { notify } from "../util/notify";
import { craftTotals, progressFraction } from "./craftProgress";
import type { GridSelection } from "./network";
import { useNetwork } from "./network";
import { usePrefs } from "./prefs";
import { useToast } from "./toast";

/**
 * A `CpuSummary` (CPU list entry) tagged with its source grid and, while `detailScope` covers it, the
 * latest per-CPU detail plus a derived progress estimate.
 */
export interface CpuView extends CpuSummary {
    /** The map key from the CPU list: stable for as long as the CPU exists. `name` is display-only. */
    cpuKey: string;
    /** The real grid key this row came from - never `"all"`, even in All-Grids mode. */
    sourceGridKey: GridKey;
    /** Owner-derived label for the source grid; only meaningful in All-Grids mode. */
    gridLabel: string;
    /** Per-CPU detail, fetched only within `detailScope` and only for busy CPUs. */
    detail: CpuDetail | null;
    /**
     * `Date.now()` when `detail` was fetched - `detail.timeElapsed`/`timeStarted` are the *server's*
     * clock, so callers needing a live-ticking elapsed must add `Date.now() - fetchedAt` rather than
     * trusting `Date.now() - timeStarted` directly (client/server clock skew).
     */
    fetchedAt: number | null;
    /** 0-99, or null when there's nothing to derive a bar from (untracked, or no detail yet). */
    progressPct: number | null;
}

/**
 * Which busy CPUs the expensive per-CPU detail fan-in should cover this poll cycle - `null` fetches none,
 * `"all"` fetches every busy CPU (the Jobs view), and a specific CPU fetches just that one (Craft
 * Detail, which only ever needs the one it's showing). Narrower than plain on/off so opening Craft
 * Detail doesn't keep fanning detail requests out to every other busy CPU in the background.
 */
export type DetailScope = "all" | { gridKey: GridKey; cpuKey: string } | null;

export interface CpusContextValue {
    cpus: CpuView[];
    busyCount: number;
    loading: boolean;
    error: string | null;
    /** Grid labels that failed during an All-Grids CPU-list fan-out. */
    failedGrids: string[];
    /**
     * Fans the expensive per-busy-CPU detail in on top of the CPU list. Callers gate this to when it's
     * actually shown (Jobs: `"all"`, Craft Detail: the one CPU it's rendering) - never globally - per
     * the server-thread drain budget (`CoreEngine.DRAIN_BUDGET_NANOS`, `AE2Controller.requests`'
     * 32-slot queue).
     */
    detailScope: DetailScope;
    setDetailScope: (scope: DetailScope) => void;
    /** Suppresses the next busy->idle completion toast/notification for one CPU (a drawer-initiated cancel). */
    suppressCompletion: (gridKey: GridKey, cpuKey: string) => void;
    refresh: () => Promise<void>;
}

const CpusContext = createContext<CpusContextValue | null>(null);

const SINGLE_GRID_INTERVAL_MS = 2500;
const ALL_GRIDS_INTERVAL_MS = 5000;

/** CPU identity across grids: CPU keys are only unique within one grid. */
function cpuIdentity(gridKey: GridKey, cpuKey: string): string {
    return `${gridKey} ${cpuKey}`;
}

function computeTargets(selection: GridSelection, allGrids: GridSummary[]): GridSummary[] {
    if (selection === "all") return allGrids;
    const grid = allGrids.find((g) => g.key === selection);
    return grid ? [grid] : [];
}

/**
 * Clamped to [0, 99] so it can never read 100% before the CPU actually reports idle (the risk logged at
 * REDESIGN_MILESTONES.md:297), and it can move non-monotonically since it's derived from crafted totals.
 * See `craftProgress.ts` for the underlying `requested ~= craftedTotal + active + pending` approximation
 * (REDESIGN_MILESTONES.md caveat 1) shared with the Craft Detail page.
 */
function estimateProgress(detail: CpuDetail | null, hasTrackingInfo: boolean): number | null {
    if (!hasTrackingInfo || !detail?.items) return null;
    const totals = craftTotals(detail.items);
    if (totals.requested <= 0) return null;
    return Math.min(99, Math.max(0, progressFraction(totals) * 100));
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
    const [detailScope, setDetailScope] = useState<DetailScope>(null);

    // "Latest ref" mirrors of props/state the poll loop reads every cycle without needing to restart
    // the effect (and therefore the loop's timer/generation/completion-tracking) whenever they change.
    const gridsRef = useRef(grids);
    gridsRef.current = grids;
    const detailScopeRef = useRef(detailScope);
    detailScopeRef.current = detailScope;
    const notifyEnabledRef = useRef(notifyEnabled);
    notifyEnabledRef.current = notifyEnabled;

    const generationRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastBusyRef = useRef<Map<string, LastBusyEntry>>(new Map());
    const suppressRef = useRef<Set<string>>(new Set());
    const seededGenerationRef = useRef(-1);
    const runNowRef = useRef<() => Promise<void>>(async () => {});

    const suppressCompletion = useCallback((gridKey: GridKey, cpuKey: string) => {
        suppressRef.current.add(cpuIdentity(gridKey, cpuKey));
    }, []);

    // Force one immediate cycle whenever the detail scope changes (Jobs mounts, or Craft Detail opens
    // targeting a different CPU), rather than waiting out whatever's left of the current list-only
    // interval - otherwise the view can show stale/empty detail for up to the poll interval.
    useEffect(() => {
        if (detailScope !== null) void runNowRef.current();
    }, [detailScope]);

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
                    nextBusy.set(cpuIdentity(cpu.sourceGridKey, cpu.cpuKey), {
                        cpuName: cpu.name,
                        itemname: cpu.finalOutput.itemname,
                        quantity: cpu.finalOutput.quantity,
                    });
                }
            }
            if (!firstCycleOfGeneration) {
                for (const [key, prev] of lastBusyRef.current) {
                    if (nextBusy.has(key)) continue; // still busy
                    // A key that disappeared entirely (not just gone idle) is a removed cluster - not a
                    // completion, so only fire for a key still present but now idle.
                    const stillPresent = collected.some((c) => cpuIdentity(c.sourceGridKey, c.cpuKey) === key);
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
                            for (const [cpuKey, summary] of Object.entries(list)) {
                                collected.push({
                                    ...summary,
                                    cpuKey,
                                    sourceGridKey: grid.key,
                                    gridLabel: label,
                                    detail: null,
                                    fetchedAt: null,
                                    progressPct: null,
                                });
                            }
                        } catch {
                            failed.push(gridOptionLabel(grid, gridsRef.current));
                        }
                    }

                    const scope = detailScopeRef.current;
                    if (scope !== null) {
                        // Sequential, not fanned out: each detail read is a server-thread task under a 5ms/tick
                        // drain budget (CoreEngine.DRAIN_BUDGET_NANOS) - see REDESIGN_MILESTONES.md caveat 2.
                        for (const cpu of collected) {
                            if (generation !== generationRef.current) return;
                            if (!cpu.isBusy) continue;
                            if (
                                scope !== "all" &&
                                (scope.gridKey !== cpu.sourceGridKey || scope.cpuKey !== cpu.cpuKey)
                            ) {
                                continue;
                            }
                            try {
                                const detail = await getCpu(cpu.sourceGridKey, cpu.cpuKey);
                                cpu.detail = detail;
                                cpu.fetchedAt = Date.now();
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
            detailScope,
            setDetailScope,
            suppressCompletion,
            refresh,
        }),
        [cpus, busyCount, loading, error, failedGrids, detailScope, suppressCompletion, refresh],
    );

    return <CpusContext.Provider value={value}>{children}</CpusContext.Provider>;
}

export function useCpus(): CpusContextValue {
    const ctx = useContext(CpusContext);
    if (!ctx) throw new Error("useCpus must be used within a CpusProvider");
    return ctx;
}

export { cpuIdentity };
