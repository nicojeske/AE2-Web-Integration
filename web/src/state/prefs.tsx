import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";

import type { StatsRange } from "../api/types";

const FAVORITES_KEY = "ae2.favorites";
const THRESHOLDS_KEY = "ae2.thresholds";
const NOTIFY_KEY = "ae2.notifyEnabled";
const BROWSER_FILTERS_KEY = "ae2.browserFilters";
const STATS_VIEWS_KEY = "ae2.statsViews";
const SETTINGS_KEY = "ae2.settings";
const SCHEMA_KEY = "ae2.schema";

/**
 * Bumped whenever a prefs key's shape changes in a way old data can't just fall back through
 * `readJSON`'s default - nothing to migrate yet (M11 is this schema's first version), but the M13
 * server-sync slice needs a versioned blob to upload instead of six loose keys, so the plumbing starts
 * here rather than being invented under time pressure later.
 */
const CURRENT_SCHEMA_VERSION = 1;

function migratePrefsSchema(): void {
    const raw = localStorage.getItem(SCHEMA_KEY);
    const from = raw === null ? 0 : Number(raw);
    if (Number.isFinite(from) && from >= CURRENT_SCHEMA_VERSION) return;
    // No migrations exist yet - this only stamps the version so a future one has something to compare
    // against.
    localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA_VERSION));
}
// Runs once per page load (this module is only ever imported by the one PrefsProvider instance the
// app mounts) - not worth re-running on every render inside the provider for a check this cheap either
// way, but doing it at import time keeps the provider's own body free of one-time setup noise.
migratePrefsSchema();

/** Per-item auto-craft configuration, keyed by `prefsKey(gridId, itemid)`. Also used by M6. */
export interface Thresholds {
    alertBelow: number;
    keepStock: number;
    batchSize: number;
    autoCraft: boolean;
}

/** Defaults applied the moment an item is favourited (design's "Defaults on favoriting"). */
export const DEFAULT_THRESHOLDS: Thresholds = {
    alertBelow: 100,
    keepStock: 200,
    batchSize: 64,
    autoCraft: false,
};

/**
 * Favorites/thresholds are keyed on `itemid`, never `hashcode` - `hashcode` is `stack.hashCode()`
 * held in a server-side map that every `items` call wipes (see REDESIGN_MILESTONES.md caveat 3), so
 * it isn't a stable identity across requests.
 */
export function prefsKey(gridId: number, itemid: string): string {
    return `${gridId}:${itemid}`;
}

/** The browser toolbar's four filter/sort pills - legacy webpage.html cookie-persisted these too. */
export interface BrowserFilters {
    storedCraftable: 0 | 1 | 2;
    itemsType: 0 | 1 | 2;
    sortBy: 0 | 1 | 2;
    sortOrder: 0 | 1;
}

export const DEFAULT_BROWSER_FILTERS: BrowserFilters = {
    storedCraftable: 2,
    itemsType: 2,
    sortBy: 0,
    sortOrder: 0,
};

/** A saved Statistics compare view (M8). Scoped to the grid it was saved on via `gridId`. */
export interface StatsView {
    id: string;
    gridId: number;
    name: string;
    itemids: string[];
    range: StatsRange;
}

/** App-wide display/behavior knobs (M11's Settings modal) - one blob rather than one key each, since
 *  none of these need independent migration and a single object is one read/write pair to reason about. */
export interface Settings {
    /** `formatNumber`'s mode (`api/format.ts`) - "compact" restores the legacy UI's large-quantity
     *  readability at GTNH scale (`1.2M` instead of `1,204,532`). */
    numberFormat: "full" | "compact";
    /** Reserved for the Browser/History table-density work this milestone sets the switch up for. */
    density: "comfortable" | "compact";
    /** Minimum item-card width (px) feeding the Browser grid's `minmax(...)` - the legacy UI's
     *  "items per row" knob, expressed as a size instead of a fixed column count so it still reflows. */
    tileMin: number;
    /** Arms `state/items.tsx`'s own poll independently of auto-craft's (which stays armed regardless of
     *  this setting, at its own fixed cadence, whenever an auto-craft favourite exists). */
    autoRefreshItems: "off" | "15s" | "30s" | "60s";
    /** Statistics' range/compare-range reset every visit otherwise, unlike every other browser
     *  preference - persisted here so a Settings default at least survives a reload. */
    statsRange: StatsRange;
}

export const DEFAULT_SETTINGS: Settings = {
    numberFormat: "full",
    density: "comfortable",
    tileMin: 220,
    autoRefreshItems: "off",
    statsRange: "7d",
};

export const TILE_MIN_RANGE = { min: 140, max: 260 } as const;

function readJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}

function writeJSON(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
}

export interface PrefsContextValue {
    favorites: Record<string, true>;
    thresholds: Record<string, Thresholds>;
    notifyEnabled: boolean;
    browserFilters: BrowserFilters;
    isFavorite: (key: string) => boolean;
    toggleFavorite: (gridId: number, itemid: string) => void;
    removeFavorite: (key: string) => void;
    setThreshold: (key: string, field: keyof Thresholds, value: number | boolean) => void;
    setNotifyEnabled: (enabled: boolean) => void;
    setBrowserFilters: (update: (current: BrowserFilters) => BrowserFilters) => void;
    statsViews: StatsView[];
    addStatsView: (view: Omit<StatsView, "id">) => void;
    removeStatsView: (id: string) => void;
    settings: Settings;
    setSettings: (update: (current: Settings) => Settings) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children?: ComponentChildren }) {
    const [favorites, setFavorites] = useState<Record<string, true>>(() => readJSON(FAVORITES_KEY, {}));
    const [thresholds, setThresholds] = useState<Record<string, Thresholds>>(() => readJSON(THRESHOLDS_KEY, {}));
    const [notifyEnabled, setNotifyEnabledState] = useState<boolean>(() => localStorage.getItem(NOTIFY_KEY) === "1");
    const [browserFilters, setBrowserFiltersState] = useState<BrowserFilters>(() =>
        readJSON(BROWSER_FILTERS_KEY, DEFAULT_BROWSER_FILTERS),
    );
    const [statsViews, setStatsViews] = useState<StatsView[]>(() => readJSON(STATS_VIEWS_KEY, []));
    // Spread over the defaults (not a bare `readJSON` fallback) so a settings blob saved before a future
    // field existed still picks up that field's default instead of `undefined`.
    const [settings, setSettingsState] = useState<Settings>(() => ({
        ...DEFAULT_SETTINGS,
        ...readJSON(SETTINGS_KEY, {}),
    }));

    const isFavorite = useCallback((key: string) => favorites[key] === true, [favorites]);

    const toggleFavorite = useCallback((gridId: number, itemid: string) => {
        const key = prefsKey(gridId, itemid);
        setFavorites((current) => {
            const next = { ...current };
            if (next[key]) {
                delete next[key];
            } else {
                next[key] = true;
            }
            writeJSON(FAVORITES_KEY, next);
            return next;
        });
        // Seed defaults on favouriting; keep any existing entry on unfavouriting so re-starring
        // restores the previous numbers (matches the prototype's toggleFavorite).
        setThresholds((current) => {
            if (current[key]) return current;
            const next = { ...current, [key]: { ...DEFAULT_THRESHOLDS } };
            writeJSON(THRESHOLDS_KEY, next);
            return current[key] ? current : next;
        });
    }, []);

    const removeFavorite = useCallback((key: string) => {
        setFavorites((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            writeJSON(FAVORITES_KEY, next);
            return next;
        });
    }, []);

    const setThreshold = useCallback((key: string, field: keyof Thresholds, value: number | boolean) => {
        setThresholds((current) => {
            const base = current[key] ?? DEFAULT_THRESHOLDS;
            const next = { ...current, [key]: { ...base, [field]: value } };
            writeJSON(THRESHOLDS_KEY, next);
            return next;
        });
    }, []);

    const setNotifyEnabled = useCallback((enabled: boolean) => {
        localStorage.setItem(NOTIFY_KEY, enabled ? "1" : "0");
        setNotifyEnabledState(enabled);
    }, []);

    const setBrowserFilters = useCallback((update: (current: BrowserFilters) => BrowserFilters) => {
        setBrowserFiltersState((current) => {
            const next = update(current);
            writeJSON(BROWSER_FILTERS_KEY, next);
            return next;
        });
    }, []);

    // `id` is a string, not a bare `Date.now()` - two saves in the same millisecond would collide.
    const addStatsView = useCallback((view: Omit<StatsView, "id">) => {
        setStatsViews((current) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const next = [...current, { ...view, id }];
            writeJSON(STATS_VIEWS_KEY, next);
            return next;
        });
    }, []);

    const removeStatsView = useCallback((id: string) => {
        setStatsViews((current) => {
            const next = current.filter((v) => v.id !== id);
            writeJSON(STATS_VIEWS_KEY, next);
            return next;
        });
    }, []);

    const setSettings = useCallback((update: (current: Settings) => Settings) => {
        setSettingsState((current) => {
            const next = update(current);
            writeJSON(SETTINGS_KEY, next);
            return next;
        });
    }, []);

    const value = useMemo<PrefsContextValue>(
        () => ({
            favorites,
            thresholds,
            notifyEnabled,
            browserFilters,
            isFavorite,
            toggleFavorite,
            removeFavorite,
            setThreshold,
            setNotifyEnabled,
            setBrowserFilters,
            statsViews,
            addStatsView,
            removeStatsView,
            settings,
            setSettings,
        }),
        [
            favorites,
            thresholds,
            notifyEnabled,
            browserFilters,
            isFavorite,
            toggleFavorite,
            removeFavorite,
            setThreshold,
            setNotifyEnabled,
            setBrowserFilters,
            statsViews,
            addStatsView,
            removeStatsView,
            settings,
            setSettings,
        ],
    );

    return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
    const ctx = useContext(PrefsContext);
    if (!ctx) throw new Error("usePrefs must be used within a PrefsProvider");
    return ctx;
}
