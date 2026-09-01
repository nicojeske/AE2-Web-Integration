import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";

import { getGrids } from "../api/client";
import type { GridSummary } from "../api/types";
import { parseHash } from "../shell/route";

const SELECTED_GRID_STORAGE_KEY = "ae2.selectedGrid";

/** `"all"` fans requests out across every accessible grid - the reason Statistics (state/stats.tsx) is
 *  single-grid only: its tracked-item set and cap are per-grid server-side, with no sane "all" story. */
export type GridSelection = "all" | number;

export interface NetworkContextValue {
    /** Every grid the server returned, including disabled (`key === -1`) admin-only entries. */
    grids: GridSummary[];
    loading: boolean;
    error: string | null;
    selected: GridSelection;
    selectedGrid: GridSummary | null;
    selectGrid: (selection: GridSelection) => void;
    refresh: () => Promise<void>;
}

/**
 * The URL's own `?grid=` wins over the persisted selection when both are present (M11) - a deep link
 * should show what it names, not whatever was last selected in this browser. `shell/route.ts`'s own
 * "URL wins on Back/Forward" effect (`App.tsx`) then only ever fires for a *later* hash change, since
 * this already settles the very first render to match - see that effect's comment for why the ordering
 * matters (skipping this would race the initial URL->state sync against the state->URL mirror).
 */
function readInitialSelection(): GridSelection {
    const fromUrl = parseHash(window.location.hash).grid;
    if (fromUrl !== null) return fromUrl;
    const raw = localStorage.getItem(SELECTED_GRID_STORAGE_KEY);
    if (raw === null || raw === "all") return "all";
    const n = Number(raw);
    return Number.isFinite(n) ? n : "all";
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children?: ComponentChildren }) {
    const [grids, setGrids] = useState<GridSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelectedState] = useState<GridSelection>(() => readInitialSelection());

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setGrids(await getGrids());
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const selectGrid = useCallback((selection: GridSelection) => {
        setSelectedState(selection);
        localStorage.setItem(SELECTED_GRID_STORAGE_KEY, String(selection));
    }, []);

    const selectedGrid = useMemo(
        () => (selected === "all" ? null : (grids.find((g) => g.key === selected) ?? null)),
        [grids, selected],
    );

    const value = useMemo<NetworkContextValue>(
        () => ({ grids, loading, error, selected, selectedGrid, selectGrid, refresh }),
        [grids, loading, error, selected, selectedGrid, selectGrid, refresh],
    );

    return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
    const ctx = useContext(NetworkContext);
    if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
    return ctx;
}
