// Statistics store (M8) - shape follows history.tsx (context + provider + throwing hook); the poll
// loop follows cpus.tsx's self-scheduling setTimeout (not setInterval), restarting cleanly whenever
// the grid or range changes instead of layering extra "force a refetch" effects on top for those two.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getItemHistory } from "../api/client";
import type { GridKey, ItemHistoryResult, StatsRange } from "../api/types";
import { CARD_POINTS, COMPARE_POINTS, DEFAULT_CUSTOM_MINUTES, toValues } from "../views/statsModel";
import { useNetwork } from "./network";
import { usePrefs } from "./prefs";

/** The server answers at most this many series per request, so it also caps a grid's pinned cards. */
export const MAX_PINNED = 50;

export interface HistoryBundle {
    from: number;
    to: number;
    stepMillis: number;
    resolution: "fine" | "hourly";
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
        count,
        timestamps,
        byItem,
        fetchedAt: Date.now(),
    };
}

export interface StatsContextValue {
    /** `null` in All-Grids mode or with no grid selected - history is per grid server-side, so
     *  Statistics is single-grid only. */
    gridKey: GridKey | null;
    range: StatsRange;
    setRange: (r: StatsRange) => void;
    /** Only meaningful (and only sent to the server) while `range === "custom"`. */
    customMinutes: number;
    setCustomMinutes: (m: number) => void;

    /** This grid's pinned items (synced prefs), in card order. Every item has history; pins only pick cards. */
    pinned: string[];
    /** Last display name the server saw for each item fetched so far, keyed by itemid - the fallback an
     *  item keeps once it empties out and drops out of `useItems()`. */
    names: Record<string, string>;

    history: HistoryBundle | null;
    historyLoading: boolean;
    historyError: string | null;

    compareRange: StatsRange;
    setCompareRange: (r: StatsRange) => void;
    compareCustomMinutes: number;
    setCompareCustomMinutes: (m: number) => void;
    compareHistory: HistoryBundle | null;
    compareLoading: boolean;
    /** The compare modal calls this on mount/unmount so its higher-resolution bundle only polls while open. */
    setCompareActive: (active: boolean) => void;
    /** The items the open compare modal charts. */
    setCompareItems: (itemids: string[]) => void;

    /** Shell calls this, mirroring the `detailScope` precedent in cpus.tsx - only poll while visible. */
    setActive: (active: boolean) => void;
    refresh: () => Promise<void>;
    pin: (itemid: string) => void;
    unpin: (itemid: string) => void;
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
    const { settings, setSettings, statsPinned, setStatsPinned } = usePrefs();

    const gridKey = selected !== "all" && selectedGrid ? selectedGrid.key : null;
    const pinnedForGrid = gridKey === null ? undefined : statsPinned[gridKey];
    const pinned = useMemo(() => pinnedForGrid ?? [], [pinnedForGrid]);
    const pinnedKey = pinned.join(",");

    // Seeded from the Settings modal's persisted default (state/prefs.tsx) - every other Statistics
    // control resets on reload same as before; only the main range mirrors back into that setting below,
    // since it's the one control users complained about resetting (unlike the Browser filters, which
    // already persist on their own).
    const [range, setRangeState] = useState<StatsRange>(() => settings.statsRange);
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);
    const [compareRange, setCompareRange] = useState<StatsRange>("7d");
    const [compareCustomMinutes, setCompareCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);

    const [names, setNames] = useState<Record<string, string>>({});
    const [compareItems, setCompareItemsState] = useState<string[]>([]);

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
    const customMinutesRef = useRef(customMinutes);
    customMinutesRef.current = customMinutes;
    const compareRangeRef = useRef(compareRange);
    compareRangeRef.current = compareRange;
    const compareCustomMinutesRef = useRef(compareCustomMinutes);
    compareCustomMinutesRef.current = compareCustomMinutes;
    const activeRef = useRef(active);
    activeRef.current = active;
    const compareActiveRef = useRef(compareActive);
    compareActiveRef.current = compareActive;
    const pinnedRef = useRef(pinned);
    pinnedRef.current = pinned;
    const compareItemsRef = useRef(compareItems);
    compareItemsRef.current = compareItems;

    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const runNowRef = useRef<() => Promise<void>>(async () => {});

    const setActive = useCallback((next: boolean) => setActiveState(next), []);
    const setCompareActive = useCallback((next: boolean) => setCompareActiveState(next), []);
    const setCompareItems = useCallback((ids: string[]) => setCompareItemsState(ids), []);
    const setRange = useCallback(
        (r: StatsRange) => {
            setRangeState(r);
            setSettings((s) => (s.statsRange === r ? s : { ...s, statsRange: r }));
        },
        [setSettings],
    );

    // Grid change: hard-reset so a stale grid's cards never paint under the new selection - the poll
    // effect below (restarting on `gridKey`) refetches history on top of this.
    useEffect(() => {
        setNames({});
        setHistory(null);
        setHistoryError(null);
        setCompareHistory(null);
    }, [gridKey]);

    const fetchBundle = useCallback(
        async (grid: GridKey, r: StatsRange, points: number, items: string[], minutes: number) => {
            const result = await getItemHistory(grid, r, points, items, minutes);
            setNames((current) => ({ ...current, ...result.names }));
            return toBundle(result);
        },
        [],
    );

    // Poll loop for the card bundle - restarts cleanly on a grid, range or pinned-set change (mirroring
    // cpus.tsx's restart-on-selection-change), so no separate "force an immediate fetch" effect is
    // needed for either. `active`/`compareActive`/`compareRange` are read from refs each cycle and
    // get their own small trigger effects below instead, since they shouldn't tear down the timer.
    useEffect(() => {
        let stopped = false;

        const runAndSchedule = async (): Promise<void> => {
            if (stopped) return;
            if (gridKey === null || !activeRef.current || document.hidden) {
                timerRef.current = setTimeout(() => void runAndSchedule(), POLL_MS);
                return;
            }
            setHistoryLoading(true);
            try {
                const items = pinnedRef.current;
                const bundle =
                    items.length === 0
                        ? null
                        : await fetchBundle(gridKey, rangeRef.current, CARD_POINTS, items, customMinutesRef.current);
                if (!stopped) {
                    setHistory(bundle);
                    setHistoryError(null);
                }
            } catch (e) {
                if (!stopped) {
                    setHistoryError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (!stopped) setHistoryLoading(false);
            }

            if (!stopped && compareActiveRef.current && compareItemsRef.current.length > 0) {
                setCompareLoading(true);
                try {
                    const bundle = await fetchBundle(
                        gridKey,
                        compareRangeRef.current,
                        COMPARE_POINTS,
                        compareItemsRef.current,
                        compareCustomMinutesRef.current,
                    );
                    if (!stopped) setCompareHistory(bundle);
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
    }, [gridKey, range, customMinutes, pinnedKey, fetchBundle]);

    // Becoming the active section (or the compare modal opening/changing its own range) should
    // refetch immediately rather than waiting out whatever's left of the 60s interval. Both fire on
    // mount too, but guarded by their own `if`, so the initial `false` values are a no-op - no
    // duplicate fetch alongside the poll effect's own immediate first cycle above.
    useEffect(() => {
        if (active) void runNowRef.current();
    }, [active]);
    useEffect(() => {
        if (compareActive) void runNowRef.current();
    }, [compareActive, compareRange, compareCustomMinutes, compareItems]);

    const refresh = useCallback(() => runNowRef.current(), []);

    const pin = useCallback(
        (itemid: string) => {
            if (gridKey === null || pinned.includes(itemid) || pinned.length >= MAX_PINNED) return;
            setStatsPinned(gridKey, [...pinned, itemid]);
        },
        [gridKey, pinned, setStatsPinned],
    );

    const unpin = useCallback(
        (itemid: string) => {
            if (gridKey === null) return;
            setStatsPinned(
                gridKey,
                pinned.filter((id) => id !== itemid),
            );
        },
        [gridKey, pinned, setStatsPinned],
    );

    const value = useMemo<StatsContextValue>(
        () => ({
            gridKey,
            range,
            setRange,
            customMinutes,
            setCustomMinutes,
            pinned,
            names,
            history,
            historyLoading,
            historyError,
            compareRange,
            setCompareRange,
            compareCustomMinutes,
            setCompareCustomMinutes,
            compareHistory,
            compareLoading,
            setCompareActive,
            setCompareItems,
            setActive,
            refresh,
            pin,
            unpin,
        }),
        [
            gridKey,
            range,
            customMinutes,
            pinned,
            names,
            history,
            historyLoading,
            historyError,
            compareRange,
            compareCustomMinutes,
            compareHistory,
            compareLoading,
            setCompareActive,
            setCompareItems,
            setActive,
            refresh,
            pin,
            unpin,
        ],
    );

    return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsContextValue {
    const ctx = useContext(StatsContext);
    if (!ctx) throw new Error("useStats must be used within a StatsProvider");
    return ctx;
}
