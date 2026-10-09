import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { getPrefs, setPrefs as apiSetPrefs } from "../api/client";
import type { GridKey, GTMachineStatus, StatsRange } from "../api/types";
import type { ChartScale } from "../views/statsModel";

const FAVORITES_KEY = "ae2.favorites";
const THRESHOLDS_KEY = "ae2.thresholds";
const NOTIFY_KEY = "ae2.notifyEnabled";
const BROWSER_FILTERS_KEY = "ae2.browserFilters";
const STATS_VIEWS_KEY = "ae2.statsViews";
const STATS_PINNED_KEY = "ae2.statsPinned";
const MACHINE_FILTERS_KEY = "ae2.machineFilters";
const MAIN_POWER_SOURCE_KEY = "ae2.mainPowerSource";
const PASSIVE_MACHINES_KEY = "ae2.passiveMachines";
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

/** Per-item auto-craft configuration, keyed by `prefsKey(gridKey, itemid)`. Also used by M6. */
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
 * Favorites/thresholds are keyed on `itemid`, never `itemKey` - the itemid is readable and version
 * independent, and it is what the statistics history is keyed by too.
 */
export function prefsKey(gridKey: GridKey, itemid: string): string {
    return `${gridKey}:${itemid}`;
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

/** The GT Machines view's filters (the free-text search isn't persisted, same as the Browser's). */
export interface MachineFilters {
    /** Empty = every status. */
    statuses: GTMachineStatus[];
    /** `dimName` (or `"dim <n>"` when a machine has none), or `null` for every dimension. */
    dimension: string | null;
    showUnloaded: boolean;
    /**
     * Whether a passive machine in a problem state shows in that status group; `false` keeps it in the
     * Passive group whatever its status.
     */
    passiveProblems: boolean;
}

export const DEFAULT_MACHINE_FILTERS: MachineFilters = {
    statuses: [],
    dimension: null,
    showUnloaded: true,
    passiveProblems: true,
};

/**
 * GT machines the user sorted by hand, by machine id: `true` = passive (tucked into the Machines tab's
 * collapsed "Passive" group while healthy), `false` = "not passive" (a dismissed server suggestion).
 */
export type PassiveMachines = Record<string, boolean>;

/** A saved Statistics compare view (M8). Scoped to the grid it was saved on via `gridKey`. */
export interface StatsView {
    id: string;
    gridKey: GridKey;
    name: string;
    itemids: string[];
    range: StatsRange;
}

/** The items each grid's Statistics page shows as cards, by grid key, in display order. */
export type StatsPinned = Record<GridKey, string[]>;

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
    /** Statistics chart card plot height (`statsModel.ts`'s `CHART_SIZE_PX`). */
    statsChartSize: "s" | "m" | "l";
    /** Linear or log y-axis for every Statistics chart - log treats non-positive samples as gaps. */
    chartScale: ChartScale;
    /** Overlays a moving-average line (`statsModel.ts`'s `movingAverage`/`SMOOTHING_WINDOW`) on every
     *  Statistics chart, dimmed under the raw line. */
    chartSmoothing: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    numberFormat: "full",
    density: "comfortable",
    tileMin: 220,
    autoRefreshItems: "off",
    statsRange: "7d",
    statsChartSize: "m",
    chartScale: "linear",
    chartSmoothing: false,
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

/**
 * The subset of prefs that follows a player across devices (M13) - favourites, thresholds, the Browser
 * toolbar filters, saved Statistics views and pinned items, and the GT Machines filters. Deliberately excludes
 * `notifyEnabled` and `settings` (M11): those are this device's own display/notification preferences,
 * not account data, and syncing e.g. `tileMin` across a phone and a desktop would fight whichever one
 * saved last. The server never
 * looks inside this shape at all - it stores whatever string this serializes to, verbatim, per
 * principal - so `schemaVersion` here is purely this client's own concern, unrelated to `CURRENT_SCHEMA_VERSION`'s
 * localStorage migration bookkeeping above.
 */
interface SyncedPrefs {
    schemaVersion: number;
    favorites: Record<string, true>;
    thresholds: Record<string, Thresholds>;
    browserFilters: BrowserFilters;
    statsViews: StatsView[];
    statsPinned: StatsPinned;
    machineFilters: MachineFilters;
    /** The Power tab's pinned main LSC (a `/gt/power` source id) - `null` picks the largest one. */
    mainPowerSource: string | null;
    passiveMachines: PassiveMachines;
}

function serializeSyncedPrefs(p: Omit<SyncedPrefs, "schemaVersion">): string {
    const blob: SyncedPrefs = { schemaVersion: CURRENT_SCHEMA_VERSION, ...p };
    return JSON.stringify(blob);
}

/** `null` on anything unparsable - the caller keeps whatever's already local rather than adopting junk. */
function parseSyncedPrefs(raw: string): SyncedPrefs | null {
    try {
        const parsed = JSON.parse(raw) as Partial<SyncedPrefs> | null;
        if (parsed === null || typeof parsed !== "object") return null;
        return {
            schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
            favorites: parsed.favorites ?? {},
            thresholds: parsed.thresholds ?? {},
            browserFilters: { ...DEFAULT_BROWSER_FILTERS, ...parsed.browserFilters },
            statsViews: parsed.statsViews ?? [],
            statsPinned:
                parsed.statsPinned !== null && typeof parsed.statsPinned === "object" ? parsed.statsPinned : {},
            machineFilters: { ...DEFAULT_MACHINE_FILTERS, ...parsed.machineFilters },
            mainPowerSource: typeof parsed.mainPowerSource === "string" ? parsed.mainPowerSource : null,
            passiveMachines:
                parsed.passiveMachines !== null && typeof parsed.passiveMachines === "object"
                    ? parsed.passiveMachines
                    : {},
        };
    } catch {
        return null;
    }
}

/** Debounce for pushing a synced-prefs change to the server - long enough that a burst of edits (e.g.
 *  ticking through several favourites) becomes one request, short enough that closing the tab shortly
 *  after an edit rarely loses it. */
const PREFS_PUSH_DEBOUNCE_MS = 800;

export interface PrefsContextValue {
    favorites: Record<string, true>;
    thresholds: Record<string, Thresholds>;
    notifyEnabled: boolean;
    browserFilters: BrowserFilters;
    isFavorite: (key: string) => boolean;
    toggleFavorite: (gridKey: GridKey, itemid: string) => void;
    removeFavorite: (key: string) => void;
    setThreshold: (key: string, field: keyof Thresholds, value: number | boolean) => void;
    setNotifyEnabled: (enabled: boolean) => void;
    setBrowserFilters: (update: (current: BrowserFilters) => BrowserFilters) => void;
    machineFilters: MachineFilters;
    setMachineFilters: (update: (current: MachineFilters) => MachineFilters) => void;
    mainPowerSource: string | null;
    setMainPowerSource: (id: string | null) => void;
    passiveMachines: PassiveMachines;
    /** Marks (`true`), dismisses (`false`) or forgets (`null`) every one of `ids`. */
    setPassive: (ids: string[], value: boolean | null) => void;
    statsViews: StatsView[];
    addStatsView: (view: Omit<StatsView, "id">) => void;
    removeStatsView: (id: string) => void;
    statsPinned: StatsPinned;
    /** Replaces the pinned items of one grid. */
    setStatsPinned: (gridKey: GridKey, itemids: string[]) => void;
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
    const [statsPinned, setStatsPinnedState] = useState<StatsPinned>(() => readJSON(STATS_PINNED_KEY, {}));
    const [machineFilters, setMachineFiltersState] = useState<MachineFilters>(() => ({
        ...DEFAULT_MACHINE_FILTERS,
        ...readJSON(MACHINE_FILTERS_KEY, {}),
    }));
    const [mainPowerSource, setMainPowerSourceState] = useState<string | null>(() =>
        readJSON<string | null>(MAIN_POWER_SOURCE_KEY, null),
    );
    const [passiveMachines, setPassiveMachines] = useState<PassiveMachines>(() => readJSON(PASSIVE_MACHINES_KEY, {}));
    // Spread over the defaults (not a bare `readJSON` fallback) so a settings blob saved before a future
    // field existed still picks up that field's default instead of `undefined`.
    const [settings, setSettingsState] = useState<Settings>(() => ({
        ...DEFAULT_SETTINGS,
        ...readJSON(SETTINGS_KEY, {}),
    }));

    // Guards the push effect below against firing on the values this same reconciliation itself just
    // adopted, before the initial fetch has even had a chance to run.
    const hasHydratedRef = useRef(false);

    // One-time reconciliation with the server on mount (M13) - adopts its blob if one exists (more
    // authoritative than this browser's possibly-stale localStorage, since it represents the account
    // rather than one device), otherwise seeds the server with whatever's already here (a fresh account,
    // or an older client that predates this sync). Silently gives up on any failure - offline, or a
    // core-branch server old enough to predate `/prefs` entirely - since every one of these prefs
    // already works from localStorage alone regardless of sync.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const { blob } = await getPrefs();
                if (cancelled) return;
                if (blob === null) {
                    await apiSetPrefs(
                        serializeSyncedPrefs({
                            favorites,
                            thresholds,
                            browserFilters,
                            statsViews,
                            statsPinned,
                            machineFilters,
                            mainPowerSource,
                            passiveMachines,
                        }),
                    );
                    return;
                }
                const parsed = parseSyncedPrefs(blob);
                if (!parsed || cancelled) return;
                setFavorites(parsed.favorites);
                writeJSON(FAVORITES_KEY, parsed.favorites);
                setThresholds(parsed.thresholds);
                writeJSON(THRESHOLDS_KEY, parsed.thresholds);
                setBrowserFiltersState(parsed.browserFilters);
                writeJSON(BROWSER_FILTERS_KEY, parsed.browserFilters);
                setStatsViews(parsed.statsViews);
                writeJSON(STATS_VIEWS_KEY, parsed.statsViews);
                setStatsPinnedState(parsed.statsPinned);
                writeJSON(STATS_PINNED_KEY, parsed.statsPinned);
                setMachineFiltersState(parsed.machineFilters);
                writeJSON(MACHINE_FILTERS_KEY, parsed.machineFilters);
                setMainPowerSourceState(parsed.mainPowerSource);
                writeJSON(MAIN_POWER_SOURCE_KEY, parsed.mainPowerSource);
                setPassiveMachines(parsed.passiveMachines);
                writeJSON(PASSIVE_MACHINES_KEY, parsed.passiveMachines);
            } catch {
                // Offline, or no /prefs on this server yet - stay on localStorage alone.
            } finally {
                if (!cancelled) hasHydratedRef.current = true;
            }
        })();
        return () => {
            cancelled = true;
        };
        // Deliberately empty - runs exactly once per mount. `favorites`/`thresholds`/`browserFilters`/
        // `statsViews` are read here only as their mount-time (localStorage-loaded) snapshot, for the
        // "seed the server" branch - a real dependency array would re-run this reconciliation on every
        // later edit, which the push effect below already handles.
    }, []);

    // Pushes favourites/thresholds/browserFilters/statsViews/machineFilters to the server whenever any of them change,
    // debounced so a burst of edits becomes one request. A push that lands before the mount-time fetch
    // above resolves would either race it or (worse) overwrite a blob it hasn't read yet - `hasHydratedRef`
    // holds this off until that reconciliation has actually run once, in either direction.
    useEffect(() => {
        if (!hasHydratedRef.current) return;
        const timer = setTimeout(() => {
            void apiSetPrefs(
                serializeSyncedPrefs({
                    favorites,
                    thresholds,
                    browserFilters,
                    statsViews,
                    statsPinned,
                    machineFilters,
                    mainPowerSource,
                    passiveMachines,
                }),
            ).catch(() => {});
        }, PREFS_PUSH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [
        favorites,
        thresholds,
        browserFilters,
        statsViews,
        statsPinned,
        machineFilters,
        mainPowerSource,
        passiveMachines,
    ]);

    const isFavorite = useCallback((key: string) => favorites[key] === true, [favorites]);

    const toggleFavorite = useCallback((gridKey: GridKey, itemid: string) => {
        const key = prefsKey(gridKey, itemid);
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

    const setMachineFilters = useCallback((update: (current: MachineFilters) => MachineFilters) => {
        setMachineFiltersState((current) => {
            const next = update(current);
            writeJSON(MACHINE_FILTERS_KEY, next);
            return next;
        });
    }, []);

    const setMainPowerSource = useCallback((id: string | null) => {
        writeJSON(MAIN_POWER_SOURCE_KEY, id);
        setMainPowerSourceState(id);
    }, []);

    const setPassive = useCallback((ids: string[], value: boolean | null) => {
        setPassiveMachines((current) => {
            const next = { ...current };
            for (const id of ids) {
                if (value === null) delete next[id];
                else next[id] = value;
            }
            writeJSON(PASSIVE_MACHINES_KEY, next);
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

    const setStatsPinned = useCallback((gridKey: GridKey, itemids: string[]) => {
        setStatsPinnedState((current) => {
            const next = { ...current };
            if (itemids.length === 0) delete next[gridKey];
            else next[gridKey] = itemids;
            writeJSON(STATS_PINNED_KEY, next);
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
            machineFilters,
            setMachineFilters,
            mainPowerSource,
            setMainPowerSource,
            passiveMachines,
            setPassive,
            statsViews,
            addStatsView,
            removeStatsView,
            statsPinned,
            setStatsPinned,
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
            machineFilters,
            setMachineFilters,
            mainPowerSource,
            setMainPowerSource,
            passiveMachines,
            setPassive,
            statsViews,
            addStatsView,
            removeStatsView,
            statsPinned,
            setStatsPinned,
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
