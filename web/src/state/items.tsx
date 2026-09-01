import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getItems } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { DetailedItem } from "../api/types";
import { gridOptionLabel } from "../shell/gridLabel";
import { hasAutoCraftFavorite, isFluidId, modOf } from "../views/browserModel";
import { useNetwork } from "./network";
import { usePrefs } from "./prefs";
import type { Settings } from "./prefs";

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
    /** `Date.now()` of the last successful load (partial All-Grids failures still count), `null` before
     *  the first one or after a fully-failed refresh - feeds the topbar's "updated Ns ago" label. */
    fetchedAt: number | null;
    refresh: () => Promise<void>;
}

const ItemsContext = createContext<ItemsContextValue | null>(null);

const AUTO_REFRESH_INTERVALS: Record<Exclude<Settings["autoRefreshItems"], "off">, number> = {
    "15s": 15_000,
    "30s": 30_000,
    "60s": 60_000,
};
/** The fixed cadence auto-craft used before M11 - kept as the floor so turning the Settings toggle off
 *  doesn't stop auto-craft favourites from ever seeing fresh stock. */
const AUTOCRAFT_FALLBACK_MS = 30_000;

/** `null` when nothing needs a poll at all; otherwise the faster of the user's setting and auto-craft's
 *  own floor, so having both active doesn't leave stock staler than either alone would. */
function pollIntervalMs(autoRefresh: Settings["autoRefreshItems"], autoCraftArmed: boolean): number | null {
    const settingMs = autoRefresh === "off" ? null : AUTO_REFRESH_INTERVALS[autoRefresh];
    const autoCraftMs = autoCraftArmed ? AUTOCRAFT_FALLBACK_MS : null;
    if (settingMs === null) return autoCraftMs;
    if (autoCraftMs === null) return settingMs;
    return Math.min(settingMs, autoCraftMs);
}

export function ItemsProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected, selectedGrid } = useNetwork();
    const { favorites, thresholds, settings } = usePrefs();
    const [items, setItems] = useState<BrowserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [failedGrids, setFailedGrids] = useState<string[]>([]);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);

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
                setFetchedAt(Date.now());
            } else if (selectedGrid && selectedGrid.key !== -1) {
                const rows = await getItems(selectedGrid.key);
                setItems(toBrowserItems(rows, selectedGrid.key, gridOptionLabel(selectedGrid, grids)));
                setFetchedAt(Date.now());
            } else {
                // A persisted selection can name a grid key no longer in `grids` (stale
                // localStorage), or the disabled `key === -1` admin-only entry - neither is
                // fetchable, so surface an empty list rather than calling `items?grid=<bad key>`.
                setItems([]);
                setFetchedAt(null);
            }
        } catch (e) {
            setError(e instanceof ApiError ? e.status : e instanceof Error ? e.message : String(e));
            setItems([]);
            setFetchedAt(null);
        } finally {
            setLoading(false);
        }
    }, [grids, selected, selectedGrid]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // `items` isn't polled by anything else - armed whenever the Settings auto-refresh toggle is on, or
    // (regardless of that toggle) at least one auto-craft favourite is resolvable in the currently
    // loaded items, so auto-craft keeps seeing fresh stock even with auto-refresh left off. Before M11
    // this same test armed a fixed-cadence timer inside `state/autoCraft.tsx` directly.
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        const intervalMs = pollIntervalMs(
            settings.autoRefreshItems,
            hasAutoCraftFavorite(items, favorites, thresholds),
        );
        if (intervalMs === null) return;
        const timer = setInterval(() => {
            if (!document.hidden) void refreshRef.current();
        }, intervalMs);
        return () => clearInterval(timer);
    }, [items, favorites, thresholds, settings.autoRefreshItems]);

    const value = useMemo<ItemsContextValue>(
        () => ({ items, loading, error, failedGrids, fetchedAt, refresh }),
        [items, loading, error, failedGrids, fetchedAt, refresh],
    );

    return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems(): ItemsContextValue {
    const ctx = useContext(ItemsContext);
    if (!ctx) throw new Error("useItems must be used within an ItemsProvider");
    return ctx;
}
