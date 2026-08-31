// Crafting History store (M5) - mirrors `state/items.tsx`'s All-Grids fan-out shape: sequential per-grid
// requests, per-grid failures collected instead of blanking the page, rows tagged with their source grid.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getTrackingHistory } from "../api/client";
import type { TrackingHistoryElement } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { useCpus } from "./cpus";
import { useNetwork } from "./network";

export interface HistoryEntry extends TrackingHistoryElement {
    /** The real grid key this row came from - never `"all"`, even in All-Grids mode. */
    sourceGridId: number;
    /** Owner-derived label for the source grid; only meaningful in All-Grids mode. */
    gridLabel: string;
    /** `GetTrackingHistory`'s `id` is a per-grid int starting at 1, so All-Grids mode needs a
     *  collision-proof identity - `"{gridId}:{id}"`. */
    key: string;
}

export interface HistoryContextValue {
    entries: HistoryEntry[];
    loading: boolean;
    error: string | null;
    /** Grid labels that failed during an All-Grids fan-out, so one bad grid doesn't blank the page. */
    failedGrids: string[];
    refresh: () => Promise<void>;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

function toHistoryEntries(rows: TrackingHistoryElement[], gridId: number, gridLabel: string): HistoryEntry[] {
    return rows.map((row) => ({ ...row, sourceGridId: gridId, gridLabel, key: `${gridId}:${row.id}` }));
}

export function HistoryProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected, selectedGrid } = useNetwork();
    const { busyCount } = useCpus();
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [failedGrids, setFailedGrids] = useState<string[]>([]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let collected: HistoryEntry[];
            if (selected === "all") {
                const targets = grids.filter((g) => g.key !== -1);
                const rows: HistoryEntry[] = [];
                const failed: string[] = [];
                for (const grid of targets) {
                    try {
                        const history = await getTrackingHistory(grid.key);
                        rows.push(...toHistoryEntries(history, grid.key, gridOptionLabel(grid, grids)));
                    } catch {
                        failed.push(gridOptionLabel(grid, grids));
                    }
                }
                setFailedGrids(failed);
                collected = rows;
            } else if (selectedGrid && selectedGrid.key !== -1) {
                setFailedGrids([]);
                const history = await getTrackingHistory(selectedGrid.key);
                collected = toHistoryEntries(history, selectedGrid.key, gridOptionLabel(selectedGrid, grids));
            } else {
                // A persisted selection can name a stale grid key, or the disabled `key === -1` entry -
                // neither is fetchable (mirrors `state/items.tsx`).
                setFailedGrids([]);
                collected = [];
            }
            collected.sort((a, b) => b.timeDone - a.timeDone);
            setEntries(collected);
        } catch (e) {
            setError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [grids, selected, selectedGrid]);

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
        () => ({ entries, loading, error, failedGrids, refresh }),
        [entries, loading, error, failedGrids, refresh],
    );

    return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
    const ctx = useContext(HistoryContext);
    if (!ctx) throw new Error("useHistory must be used within a HistoryProvider");
    return ctx;
}
