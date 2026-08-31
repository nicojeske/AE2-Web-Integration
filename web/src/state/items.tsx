import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";

import { ApiError, getItems } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { DetailedItem } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { isFluidId, modOf } from "../views/browserModel";
import { useNetwork } from "./network";

/** A `DetailedItem` row tagged with derived/source fields the browser (and later M6) need. */
export interface BrowserItem extends DetailedItem {
    /** The real grid key this row came from - never `"all"`, even in All-Grids mode. */
    sourceGridId: number;
    /** Owner-derived label for the source grid; only meaningful in All-Grids mode. */
    gridLabel: string;
    mod: string;
    isFluid: boolean;
    /** `itemname` with §-formatting codes stripped, for search/sort. */
    plainName: string;
}

function toBrowserItems(rows: DetailedItem[], gridId: number, gridLabel: string): BrowserItem[] {
    return rows.map((it) => ({
        ...it,
        sourceGridId: gridId,
        gridLabel,
        mod: modOf(it.itemid),
        isFluid: isFluidId(it.itemid),
        plainName: skipSpecialFormat(it.itemname),
    }));
}

export interface ItemsContextValue {
    items: BrowserItem[];
    loading: boolean;
    error: string | null;
    /** Grid labels that failed during an All-Grids fan-out, so one bad grid doesn't blank the page. */
    failedGrids: string[];
    refresh: () => Promise<void>;
}

const ItemsContext = createContext<ItemsContextValue | null>(null);

export function ItemsProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected, selectedGrid } = useNetwork();
    const [items, setItems] = useState<BrowserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [failedGrids, setFailedGrids] = useState<string[]>([]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        setFailedGrids([]);
        try {
            if (selected === "all") {
                // Sequential, not fanned out: GetItems.java clears a single global static
                // hashcodeToStack map on every call, so concurrent `items` requests corrupt each
                // other's ordering, and the synced request queue is a 32-slot ArrayBlockingQueue
                // that answers SERVER_BUSY on overflow. Collect per-grid failures instead of
                // aborting the whole fetch so one unreachable grid doesn't blank the page.
                const targets = grids.filter((g) => g.key !== -1);
                const collected: BrowserItem[] = [];
                const failed: string[] = [];
                for (const grid of targets) {
                    try {
                        const rows = await getItems(grid.key);
                        collected.push(...toBrowserItems(rows, grid.key, gridOptionLabel(grid, grids)));
                    } catch {
                        failed.push(gridOptionLabel(grid, grids));
                    }
                }
                setItems(collected);
                setFailedGrids(failed);
            } else if (selectedGrid && selectedGrid.key !== -1) {
                const rows = await getItems(selectedGrid.key);
                setItems(toBrowserItems(rows, selectedGrid.key, gridOptionLabel(selectedGrid, grids)));
            } else {
                // A persisted selection can name a grid key no longer in `grids` (stale
                // localStorage), or the disabled `key === -1` admin-only entry - neither is
                // fetchable, so surface an empty list rather than calling `items?grid=<bad key>`.
                setItems([]);
            }
        } catch (e) {
            setError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [grids, selected, selectedGrid]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const value = useMemo<ItemsContextValue>(
        () => ({ items, loading, error, failedGrids, refresh }),
        [items, loading, error, failedGrids, refresh],
    );

    return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems(): ItemsContextValue {
    const ctx = useContext(ItemsContext);
    if (!ctx) throw new Error("useItems must be used within an ItemsProvider");
    return ctx;
}
