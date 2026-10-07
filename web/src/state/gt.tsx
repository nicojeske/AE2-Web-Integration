// GregTech hub state (docs/gt-hub/phase-2-frontend.md §3). `/gt/*` endpoints are async on the server -
// they read what GTEngine stored on its last scan, never live GregTech state - so unlike `/list`/`/get`
// polling them costs no server-thread drain budget. That's why the machines poll runs app-wide (it feeds
// the sidebar badge) and why none of these follow `settings.autoRefreshItems`, which only governs the
// item list's own (server-thread) `/items` poll.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, getGTMachines, isGTNotAvailable } from "../api/client";
import type { GTMachines } from "../api/types";
import { GT_PROBLEM_STATUSES } from "../api/types";
import { getContext } from "../context";

/** Matches the default `gt_scan_interval_seconds` - polling faster only re-reads the same scan. */
export const GT_FAST_POLL_MS = 10_000;
/** Machines while another section is showing - just enough to keep the sidebar badge honest. */
const GT_BACKGROUND_POLL_MS = 30_000;
export const GT_PRODUCTION_POLL_MS = 60_000;

export interface GTPoll<T> {
    data: T | null;
    /** The server answered NOT_AVAILABLE - render the "no GregTech" empty state, never an error toast. */
    notAvailable: boolean;
    error: string | null;
    loading: boolean;
    /** `Date.now()` of the last successful fetch. */
    fetchedAt: number | null;
}

/**
 * Polls `fetcher` every `intervalMs` (`null` = fetch once), pausing while the tab is hidden. `key`
 * identifies what's being fetched: changing it drops the old data and starts over (a new range or
 * source), while a changed `nonce` just re-fetches now (the topbar's Refresh button).
 */
export function useGTPoll<T>(
    fetcher: () => Promise<T>,
    intervalMs: number | null,
    key: string,
    nonce: number,
): GTPoll<T> {
    const [state, setState] = useState<GTPoll<T>>({
        data: null,
        notAvailable: false,
        error: null,
        loading: true,
        fetchedAt: null,
    });
    // Latest ref: the fetcher closes over view state the loop shouldn't restart for on every render.
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const keyRef = useRef(key);

    useEffect(() => {
        if (keyRef.current !== key) {
            keyRef.current = key;
            setState({ data: null, notAvailable: false, error: null, loading: true, fetchedAt: null });
        }
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const run = async (): Promise<void> => {
            if (stopped || document.hidden) return;
            try {
                const data = await fetcherRef.current();
                if (stopped) return;
                setState({ data, notAvailable: false, error: null, loading: false, fetchedAt: Date.now() });
            } catch (e) {
                if (stopped) return;
                setState((s) => ({
                    ...s,
                    notAvailable: isGTNotAvailable(e),
                    error: isGTNotAvailable(e)
                        ? null
                        : e instanceof ApiError
                          ? e.status
                          : e instanceof Error
                            ? e.message
                            : String(e),
                    loading: false,
                }));
            }
            if (!stopped && intervalMs !== null) timer = setTimeout(() => void run(), intervalMs);
        };

        const onVisibilityChange = () => {
            clearTimeout(timer);
            if (!document.hidden) void run();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        void run();

        return () => {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [key, intervalMs, nonce]);

    return state;
}

export interface GTContextValue {
    /** `getContext().hasGT` - false means every GT section is hidden and nothing here ever polls. */
    enabled: boolean;
    machines: GTPoll<GTMachines>;
    /** Loaded machines in a `GT_PROBLEM_STATUSES` status - the sidebar badge. */
    problemCount: number;
    /** Shell sets this while Machines is the visible section, which speeds its poll up to the scan rate. */
    setMachinesActive: (active: boolean) => void;
    /** Bumped by `refresh` - per-view polls (power, production) take it as their `nonce`. */
    nonce: number;
    refresh: () => void;
}

const GTContext = createContext<GTContextValue | null>(null);

const NEVER = new Promise<GTMachines>(() => {});

export function GTProvider({ children }: { children?: ComponentChildren }) {
    const enabled = getContext().hasGT;
    const [machinesActive, setMachinesActive] = useState(false);
    const [nonce, setNonce] = useState(0);

    const machines = useGTPoll(
        () => (enabled ? getGTMachines() : NEVER),
        enabled ? (machinesActive ? GT_FAST_POLL_MS : GT_BACKGROUND_POLL_MS) : null,
        "machines",
        nonce,
    );

    const problemCount = useMemo(
        () => machines.data?.machines.filter((m) => m.loaded && GT_PROBLEM_STATUSES.has(m.status)).length ?? 0,
        [machines.data],
    );

    const refresh = useCallback(() => setNonce((n) => n + 1), []);

    const value = useMemo<GTContextValue>(
        () => ({ enabled, machines, problemCount, setMachinesActive, nonce, refresh }),
        [enabled, machines, problemCount, nonce, refresh],
    );

    return <GTContext.Provider value={value}>{children}</GTContext.Provider>;
}

export function useGT(): GTContextValue {
    const ctx = useContext(GTContext);
    if (!ctx) throw new Error("useGT must be used within a GTProvider");
    return ctx;
}
