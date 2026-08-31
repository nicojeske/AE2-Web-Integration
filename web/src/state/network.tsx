import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";

import { getGrids } from "../api/client";
import type { GridSummary } from "../api/types";

const SELECTED_GRID_STORAGE_KEY = "ae2.selectedGrid";

/** `"all"` fans requests out across every accessible grid (see caveat 6 in REDESIGN_MILESTONES.md). */
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

function readStoredSelection(): GridSelection {
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
    const [selected, setSelectedState] = useState<GridSelection>(() => readStoredSelection());

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

    const value: NetworkContextValue = { grids, loading, error, selected, selectedGrid, selectGrid, refresh };

    return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
    const ctx = useContext(NetworkContext);
    if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
    return ctx;
}
