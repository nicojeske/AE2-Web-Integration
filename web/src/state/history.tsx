// Crafting History store (M5) - mirrors `state/items.tsx`'s All-Grids fan-out shape: sequential per-grid
// requests, per-grid failures collected instead of blanking the page, rows tagged with their source grid.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getTrackingHistory } from "../api/client";
import type { GridKey, TrackingHistoryElement } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { useCpus } from "./cpus";
import { useNetwork } from "./network";

export interface HistoryEntry extends TrackingHistoryElement {
    /** The real grid key this row came from - never `"all"`, even in All-Grids mode. */
    sourceGridKey: GridKey;
    /** Owner-derived label for the source grid; only meaningful in All-Grids mode. */
    gridLabel: string;
    /** `GetTrackingHistory`'s `id` is a per-grid int starting at 1, so All-Grids mode needs a
     *  collision-proof identity - `"{gridKey}:{id}"`. */
    key: string;
}

export interface HistoryContextValue {
    entries: HistoryEntry[];
    loading: boolean;
    error: string | null;
    /** Grid labels that failed during an All-Grids fan-out, so one bad grid doesn't blank the page. */
    failedGrids: string[];
    refresh: () => Promise<void>;
    /** The server has older entries than the ones loaded (some grid returned a full page). */
    hasMore: boolean;
    loadingMore: boolean;
    /** Appends the page of entries finished before the oldest one loaded. */
    loadMore: () => Promise<void>;
}

/** Entries per grid per request. */
const PAGE_SIZE = 100;

const HistoryContext = createContext<HistoryContextValue | null>(null);

function toHistoryEntries(rows: TrackingHistoryElement[], gridKey: GridKey, gridLabel: string): HistoryEntry[] {
    return rows.map((row) => ({ ...row, sourceGridKey: gridKey, gridLabel, key: `${gridKey}:${row.id}` }));
}

export function HistoryProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected, selectedGrid } = useNetwork();
    const { busyCount } = useCpus();
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [failedGrids, setFailedGrids] = useState<string[]>([]);

    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    /** One page from every selected grid, finished before `before` - merged newest first. */
    const fetchPage = useCallback(
        async (before: number | undefined) => {
            const targets = selected === "all" ? grids : selectedGrid ? [selectedGrid] : [];
            const rows: HistoryEntry[] = [];
            const failed: string[] = [];
            let full = false;
            for (const grid of targets) {
                try {
                    const page = await getTrackingHistory(grid.key, { before, limit: PAGE_SIZE });
                    full ||= page.length === PAGE_SIZE;
                    rows.push(...toHistoryEntries(page, grid.key, gridOptionLabel(grid, grids)));
                } catch (e) {
                    // One bad grid shouldn't blank the page in All-Grids mode; a single grid reports it.
                    if (selected !== "all") throw e;
                    failed.push(gridOptionLabel(grid, grids));
                }
            }
            rows.sort((a, b) => b.timeDone - a.timeDone);
            return { rows, failed, full };
        },
        [grids, selected, selectedGrid],
    );

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const page = await fetchPage(undefined);
            setEntries(page.rows);
            setFailedGrids(page.failed);
            setHasMore(page.full);
        } catch (e) {
            setError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
            setEntries([]);
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [fetchPage]);

    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const loadMore = useCallback(async () => {
        const current = entriesRef.current;
        const oldest = current[current.length - 1];
        if (!oldest) return;
        setLoadingMore(true);
        try {
            const page = await fetchPage(oldest.timeDone);
            const known = new Set(current.map((e) => e.key));
            setEntries([...current, ...page.rows.filter((r) => !known.has(r.key))]);
            setHasMore(page.full);
        } catch {
            setHasMore(false);
        } finally {
            setLoadingMore(false);
        }
    }, [fetchPage]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // A busy CPU going idle (completion or cancel) is exactly when history gains a new row.
    // `trackinghistory` is an `IAsyncRequest` - it never touches the server thread - so refetching on
    // every drop costs nothing against `CoreEngine`'s drain budget, unlike the CPU-detail poll. Left
    // unscoped to whether History is the active section (simpler than threading a "mounted" flag through
    // another provider, and just as cheap since this is a single lightweight request either way).
    const prevBusyRef = useRef(busyCount);
    useEffect(() => {
        if (busyCount < prevBusyRef.current) void refresh();
        prevBusyRef.current = busyCount;
    }, [busyCount, refresh]);

    const value = useMemo<HistoryContextValue>(
        () => ({ entries, loading, error, failedGrids, refresh, hasMore, loadingMore, loadMore }),
        [entries, loading, error, failedGrids, refresh, hasMore, loadingMore, loadMore],
    );

    return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
    const ctx = useContext(HistoryContext);
    if (!ctx) throw new Error("useHistory must be used within a HistoryProvider");
    return ctx;
}
