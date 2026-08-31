// Statistics store (M8) - shape follows history.tsx (context + provider + throwing hook); the poll
// loop follows cpus.tsx's self-scheduling setTimeout (not setInterval), restarting cleanly whenever
// the grid or range changes instead of layering extra "force a refetch" effects on top for those two.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
    addTrackedItem,
    ApiError,
    getItemHistory,
    getTrackedItems,
    removeTrackedItem,
    setTrackedItems as apiSetTrackedItems,
} from "../api/client";
import { describeApiError } from "../api/errors";
import type { ItemHistoryResult, StatsRange } from "../api/types";
import { CARD_POINTS, COMPARE_POINTS, toValues } from "../views/statsModel";
import { useNetwork } from "./network";
import { useToast } from "./toast";

export interface HistoryBundle {
    from: number;
    to: number;
    stepMillis: number;
    resolution: "fine" | "hourly";
    limit: number;
    /** Derived from the response array, never from the requested `points` - see M7 caveats. */
    count: number;
    timestamps: number[];
    byItem: Map<string, (number | null)[]>;
    fetchedAt: number;
}

function toBundle(result: ItemHistoryResult): HistoryBundle {
    const byItem = new Map<string, (number | null)[]>();
    let count = 0;
    for (const s of result.series) {
        const values = toValues(s.points);
        byItem.set(s.itemid, values);
        count = Math.max(count, values.length);
    }
    const timestamps = Array.from({ length: count }, (_, i) => result.from + i * result.stepMillis);
    return {
        from: result.from,
        to: result.to,
        stepMillis: result.stepMillis,
        resolution: result.resolution,
        limit: result.limit,
        count,
        timestamps,
        byItem,
        fetchedAt: Date.now(),
    };
}

export interface StatsContextValue {
    /** `null` in All-Grids mode, with no grid selected, or for the disabled `key === -1` grid - the
     *  tracked set and its cap are per-grid server-side, so Statistics is single-grid only. */
    gridId: number | null;
    range: StatsRange;
    setRange: (r: StatsRange) => void;

    tracked: string[];
    trackedLimit: number;
    trackedLoading: boolean;
    trackedError: string | null;

    history: HistoryBundle | null;
    historyLoading: boolean;
    historyError: string | null;

    compareRange: StatsRange;
    setCompareRange: (r: StatsRange) => void;
    compareHistory: HistoryBundle | null;
    compareLoading: boolean;
    /** The compare modal calls this on mount/unmount so its higher-resolution bundle only polls while open. */
    setCompareActive: (active: boolean) => void;

    /** Shell calls this, mirroring the `detailScope` precedent in cpus.tsx - only poll while visible. */
    setActive: (active: boolean) => void;
    refresh: () => Promise<void>;
    addTracked: (itemid: string) => Promise<void>;
    removeTracked: (itemid: string) => Promise<void>;
    setTrackedSet: (itemids: string[]) => Promise<void>;
}

const StatsContext = createContext<StatsContextValue | null>(null);

/**
 * Both endpoints are `IAsyncRequest`s (HTTP worker thread, never the server tick), so this poll costs
 * nothing against `CoreEngine`'s drain budget - the gate is `active`/`document.hidden`, not
 * server-thread cost. Samples land every 5 minutes by default; 60s bounds staleness at ~1 min.
 */
const POLL_MS = 60_000;

export function StatsProvider({ children }: { children?: ComponentChildren }) {
    const { selected, selectedGrid } = useNetwork();
    const toast = useToast();

    const gridId = selected !== "all" && selectedGrid && selectedGrid.key !== -1 ? selectedGrid.key : null;

    const [range, setRange] = useState<StatsRange>("7d");
    const [compareRange, setCompareRange] = useState<StatsRange>("7d");

    const [tracked, setTracked] = useState<string[]>([]);
    const [trackedLimit, setTrackedLimit] = useState(0);
    const [trackedLoading, setTrackedLoading] = useState(false);
    const [trackedError, setTrackedError] = useState<string | null>(null);

    const [history, setHistory] = useState<HistoryBundle | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);

    const [compareHistory, setCompareHistory] = useState<HistoryBundle | null>(null);
    const [compareLoading, setCompareLoading] = useState(false);

    const [active, setActiveState] = useState(false);
    const [compareActive, setCompareActiveState] = useState(false);

    // "Latest ref" mirrors read by the poll loop every cycle, so changing them doesn't need to
    // restart the loop's timer - same shape as cpus.tsx.
    const rangeRef = useRef(range);
    rangeRef.current = range;
    const compareRangeRef = useRef(compareRange);
    compareRangeRef.current = compareRange;
    const activeRef = useRef(active);
    activeRef.current = active;
    const compareActiveRef = useRef(compareActive);
    compareActiveRef.current = compareActive;
    const trackedRef = useRef(tracked);
    trackedRef.current = tracked;
    const gridIdForMutationRef = useRef(gridId);
    gridIdForMutationRef.current = gridId;

    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const runNowRef = useRef<() => Promise<void>>(async () => {});
    const queueRef = useRef<Promise<unknown>>(Promise.resolve());

    const setActive = useCallback((next: boolean) => setActiveState(next), []);
    const setCompareActive = useCallback((next: boolean) => setCompareActiveState(next), []);

    // Grid change: reload the tracked set fresh (it carries `limit`; `/gridsettings` doesn't) and
    // hard-reset everything else so a stale grid's cards never paint under the new selection - the
    // poll effect below (restarting on `gridId`) refetches history on top of this.
    useEffect(() => {
        let cancelled = false;
        setTracked([]);
        setTrackedLimit(0);
        setTrackedError(null);
        setHistory(null);
        setHistoryError(null);
        setCompareHistory(null);
        if (gridId === null) {
            setTrackedLoading(false);
            return;
        }
        setTrackedLoading(true);
        void getTrackedItems(gridId)
            .then((res) => {
                if (cancelled) return;
                setTracked(res.tracked);
                setTrackedLimit(res.limit);
            })
            .catch((e) => {
                if (cancelled) return;
                setTrackedError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) setTrackedLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [gridId]);

    // Poll loop for the card bundle - restarts cleanly on a grid or range change (mirroring
    // cpus.tsx's restart-on-selection-change), so no separate "force an immediate fetch" effect is
    // needed for either. `active`/`compareActive`/`compareRange` are read from refs each cycle and
    // get their own small trigger effects below instead, since they shouldn't tear down the timer.
    useEffect(() => {
        let stopped = false;

        const runAndSchedule = async (): Promise<void> => {
            if (stopped) return;
            if (gridId === null || !activeRef.current || document.hidden) {
                timerRef.current = setTimeout(() => void runAndSchedule(), POLL_MS);
                return;
            }
            setHistoryLoading(true);
            try {
                const result = await getItemHistory(gridId, rangeRef.current, CARD_POINTS);
                if (!stopped) {
                    setHistory(toBundle(result));
                    setHistoryError(null);
                }
            } catch (e) {
                if (!stopped) {
                    setHistoryError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (!stopped) setHistoryLoading(false);
            }

            if (!stopped && compareActiveRef.current) {
                setCompareLoading(true);
                try {
                    const result = await getItemHistory(gridId, compareRangeRef.current, COMPARE_POINTS);
                    if (!stopped) setCompareHistory(toBundle(result));
                } catch {
                    // The compare modal has its own error surface; keep the last-good bundle rather
                    // than blanking an open chart on one transient failure.
                } finally {
                    if (!stopped) setCompareLoading(false);
                }
            }

            if (stopped) return;
            timerRef.current = setTimeout(() => void runAndSchedule(), POLL_MS);
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
    }, [gridId, range]);

    // Becoming the active section (or the compare modal opening/changing its own range) should
    // refetch immediately rather than waiting out whatever's left of the 60s interval. Both fire on
    // mount too, but guarded by their own `if`, so the initial `false` values are a no-op - no
    // duplicate fetch alongside the poll effect's own immediate first cycle above.
    useEffect(() => {
        if (active) void runNowRef.current();
    }, [active]);
    useEffect(() => {
        if (compareActive) void runNowRef.current();
    }, [compareActive, compareRange]);

    const refresh = useCallback(() => runNowRef.current(), []);

    const applyTrackedMutation = useCallback(
        (mutate: () => Promise<{ tracked: string[]; limit: number }>) => {
            const gid = gridIdForMutationRef.current;
            if (gid === null) return Promise.resolve();
            const previous = trackedRef.current;
            const run = queueRef.current.then(async () => {
                if (gridIdForMutationRef.current !== gid) return; // grid switched while queued
                try {
                    const res = await mutate();
                    if (gridIdForMutationRef.current !== gid) return;
                    setTracked(res.tracked);
                    setTrackedLimit(res.limit);
                    void runNowRef.current();
                } catch (e) {
                    if (gridIdForMutationRef.current !== gid) return;
                    setTracked(previous);
                    toast(describeApiError(e, "Couldn't update tracked items"));
                    if (e instanceof ApiError && e.status === "TRACKED_LIMIT_REACHED") {
                        // Two-tab race: resync with the server's authoritative list.
                        try {
                            const res = await getTrackedItems(gid);
                            if (gridIdForMutationRef.current === gid) {
                                setTracked(res.tracked);
                                setTrackedLimit(res.limit);
                            }
                        } catch {
                            // Best-effort resync only; the next grid change or manual refresh recovers.
                        }
                    }
                }
            });
            queueRef.current = run;
            return run;
        },
        [toast],
    );

    const addTracked = useCallback(
        (itemid: string) => {
            const gid = gridIdForMutationRef.current;
            if (gid === null) return Promise.resolve();
            setTracked((prev) => (prev.includes(itemid) ? prev : [...prev, itemid]));
            return applyTrackedMutation(() => addTrackedItem(gid, itemid));
        },
        [applyTrackedMutation],
    );

    const removeTracked = useCallback(
        (itemid: string) => {
            const gid = gridIdForMutationRef.current;
            if (gid === null) return Promise.resolve();
            setTracked((prev) => prev.filter((x) => x !== itemid));
            return applyTrackedMutation(() => removeTrackedItem(gid, itemid));
        },
        [applyTrackedMutation],
    );

    const setTrackedSet = useCallback(
        (itemids: string[]) => {
            const gid = gridIdForMutationRef.current;
            if (gid === null) return Promise.resolve();
            setTracked(itemids);
            return applyTrackedMutation(() => apiSetTrackedItems(gid, itemids));
        },
        [applyTrackedMutation],
    );

    const value = useMemo<StatsContextValue>(
        () => ({
            gridId,
            range,
            setRange,
            tracked,
            trackedLimit,
            trackedLoading,
            trackedError,
            history,
            historyLoading,
            historyError,
            compareRange,
            setCompareRange,
            compareHistory,
            compareLoading,
            setCompareActive,
            setActive,
            refresh,
            addTracked,
            removeTracked,
            setTrackedSet,
        }),
        [
            gridId,
            range,
            tracked,
            trackedLimit,
            trackedLoading,
            trackedError,
            history,
            historyLoading,
            historyError,
            compareRange,
            compareHistory,
            compareLoading,
            setCompareActive,
            setActive,
            refresh,
            addTracked,
            removeTracked,
            setTrackedSet,
        ],
    );

    return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsContextValue {
    const ctx = useContext(StatsContext);
    if (!ctx) throw new Error("useStats must be used within a StatsProvider");
    return ctx;
}
