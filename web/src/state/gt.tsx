// GregTech hub state (docs/gt-hub/phase-2-frontend.md §3). `/gt/*` endpoints are async on the server -
// they read what GTEngine stored on its last scan, never live GregTech state - so unlike `/list`/`/get`
// polling them costs no server-thread drain budget. That's why the machines poll runs app-wide (it feeds
// the rail badge) and why none of these follow `settings.autoRefreshItems`, which only governs the
// item list's own (server-thread) `/items` poll.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
    ApiError,
    deleteGTTunnelCapacity,
    getGTLabels,
    getGTMachines,
    isGTNotAvailable,
    putGTLineName,
    putGTMachineLine,
    putGTMachineNickname,
    putGTTunnelCapacity,
} from "../api/client";
import type { GTLabels, GTMachines } from "../api/types";
import { GT_PROBLEM_STATUSES } from "../api/types";
import { getContext } from "../context";
import type { LegacyGTLabels } from "./prefs";
import { usePrefs } from "./prefs";
import { useToast } from "./toast";

/** Matches the default `gt_scan_interval_seconds` - polling faster only re-reads the same scan. */
export const GT_FAST_POLL_MS = 10_000;
/** Machines while another section is showing - just enough to keep the rail badge honest. */
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

/**
 * A user-chosen text per GT machine id: its nickname (`machineNames`) or the processing line it belongs to
 * (`machineLines`). A line exists for as long as some machine names it, so there's no line list to keep in step.
 */
export type MachineLabels = Record<string, string>;

/** What an EU P2P tunnel's line is built for, by tunnel id: `amps` at GT voltage tier `tier`. */
export interface TunnelCapacity {
    amps: number;
    tier: number;
}

/** `/gt/labels` as the views use it. Shared on the server by everyone who can see the machine or tunnel. */
interface Labels {
    machineNames: MachineLabels;
    machineLines: MachineLabels;
    tunnelCapacity: Record<string, TunnelCapacity>;
}

const NO_LABELS: Labels = { machineNames: {}, machineLines: {}, tunnelCapacity: {} };

function toLabels(data: GTLabels): Labels {
    const labels: Labels = { machineNames: {}, machineLines: {}, tunnelCapacity: { ...data.tunnels } };
    for (const [id, { nickname, line }] of Object.entries(data.machines)) {
        if (nickname) labels.machineNames[id] = nickname;
        if (line) labels.machineLines[id] = line;
    }
    return labels;
}

/** `labels` with every one of `ids` set to `value` (trimmed), or removed when it's null or blank. */
function withLabel(labels: MachineLabels, ids: string[], value: string | null): MachineLabels {
    const next = { ...labels };
    const trimmed = value?.trim() ?? "";
    for (const id of ids) {
        if (trimmed === "") delete next[id];
        else next[id] = trimmed;
    }
    return next;
}

/**
 * One-shot import of prefs-era GT labels - remove in a later release. Uploads every legacy label the server has no
 * value for yet, so the first player to load the page after the update brings their lines along and nobody's
 * server-side edits are overwritten. A label the server refuses (a machine since forgotten, or not visible to this
 * player) is dropped; any other failure leaves the legacy labels for the next page load.
 */
async function importLegacyLabels(legacy: LegacyGTLabels, server: Labels): Promise<void> {
    const writes: (() => Promise<unknown>)[] = [];
    for (const [id, name] of Object.entries(legacy.machineNames)) {
        if (!server.machineNames[id] && name.trim()) writes.push(() => putGTMachineNickname(id, name));
    }
    for (const [id, line] of Object.entries(legacy.machineLines)) {
        if (!server.machineLines[id] && line.trim()) writes.push(() => putGTMachineLine(id, line));
    }
    for (const [id, { amps, tier }] of Object.entries(legacy.tunnelCapacity)) {
        const rounded = Math.round(amps);
        if (!server.tunnelCapacity[id] && rounded > 0) writes.push(() => putGTTunnelCapacity(id, rounded, tier));
    }
    // One at a time: there are few, and each is an ordinary edit for the server's rate limits.
    for (const write of writes) {
        try {
            await write();
        } catch (e) {
            if (!(e instanceof ApiError)) throw e;
        }
    }
}

export interface GTContextValue {
    /** `getContext().hasGT` - false means every GT section is hidden and nothing here ever polls. */
    enabled: boolean;
    machines: GTPoll<GTMachines>;
    /** Loaded machines in a `GT_PROBLEM_STATUSES` status - the rail badge. */
    problemCount: number;
    /** Holds the machines poll at the scan rate; returns the release. See `useFastMachinesPoll`. */
    holdFastMachinesPoll: () => () => void;
    /** Bumped by `refresh` - per-view polls (power, production) take it as their `nonce`. */
    nonce: number;
    refresh: () => void;
    machineNames: MachineLabels;
    /** Sets a machine's nickname; blank clears it. */
    setMachineName: (id: string, name: string) => void;
    machineLines: MachineLabels;
    /** Puts every one of `ids` on `line`, or off any line for null/blank. */
    setMachineLine: (ids: string[], line: string | null) => void;
    /** Moves every machine on line `from` to `to` (merging into it when `to` already exists). */
    renameLine: (from: string, to: string) => void;
    tunnelCapacity: Record<string, TunnelCapacity>;
    /** Sets what a tunnel's line is built for; `null` forgets it. */
    setTunnelCapacity: (id: string, capacity: TunnelCapacity | null) => void;
}

const GTContext = createContext<GTContextValue | null>(null);

const NEVER = new Promise<never>(() => {});

export function GTProvider({ children }: { children?: ComponentChildren }) {
    const enabled = getContext().hasGT;
    // Count of views that want scan-rate data (Machines on screen, a craft's working machines).
    const [fastHolders, setFastHolders] = useState(0);
    const [nonce, setNonce] = useState(0);

    const machines = useGTPoll(
        () => (enabled ? getGTMachines() : NEVER),
        enabled ? (fastHolders > 0 ? GT_FAST_POLL_MS : GT_BACKGROUND_POLL_MS) : null,
        "machines",
        nonce,
    );

    const problemCount = useMemo(
        () => machines.data?.machines.filter((m) => m.loaded && GT_PROBLEM_STATUSES.has(m.status)).length ?? 0,
        [machines.data],
    );

    const refresh = useCallback(() => setNonce((n) => n + 1), []);

    // Other players' label edits arrive with this poll; this player's own show at once (`edit` below).
    const labelsPoll = useGTPoll(
        () => (enabled ? getGTLabels() : NEVER),
        enabled ? GT_BACKGROUND_POLL_MS : null,
        "labels",
        nonce,
    );
    const [labels, setLabels] = useState<Labels>(NO_LABELS);
    useEffect(() => {
        if (labelsPoll.data) setLabels(toLabels(labelsPoll.data));
    }, [labelsPoll.data]);

    const toast = useToast();
    /** Applies `change` locally right away, then `send`s it; a refused edit toasts and re-reads the server's. */
    const edit = useCallback(
        (change: (current: Labels) => Labels, send: () => Promise<unknown>) => {
            setLabels(change);
            send().catch((e: unknown) => {
                toast(e instanceof ApiError ? e.status : "Failed to save the label");
                refresh();
            });
        },
        [toast, refresh],
    );

    const setMachineName = useCallback(
        (id: string, name: string) =>
            edit(
                (l) => ({ ...l, machineNames: withLabel(l.machineNames, [id], name) }),
                () => putGTMachineNickname(id, name),
            ),
        [edit],
    );
    const setMachineLine = useCallback(
        (ids: string[], line: string | null) =>
            edit(
                (l) => ({ ...l, machineLines: withLabel(l.machineLines, ids, line) }),
                async () => {
                    for (const id of ids) await putGTMachineLine(id, line ?? "");
                },
            ),
        [edit],
    );
    const renameLine = useCallback(
        (from: string, to: string) =>
            edit(
                (l) => ({
                    ...l,
                    machineLines: withLabel(
                        l.machineLines,
                        Object.keys(l.machineLines).filter((id) => l.machineLines[id] === from),
                        to,
                    ),
                }),
                () => putGTLineName(from, to),
            ),
        [edit],
    );
    const setTunnelCapacity = useCallback(
        (id: string, capacity: TunnelCapacity | null) =>
            edit(
                (l) => {
                    const tunnelCapacity = { ...l.tunnelCapacity };
                    if (capacity === null) delete tunnelCapacity[id];
                    else tunnelCapacity[id] = capacity;
                    return { ...l, tunnelCapacity };
                },
                () =>
                    capacity === null
                        ? deleteGTTunnelCapacity(id).catch((e: unknown) => {
                              // Already clear (a removed tunnel forgets its capacity on the server).
                              if (!(e instanceof ApiError && e.status === "NOT_FOUND")) throw e;
                          })
                        : putGTTunnelCapacity(id, Math.round(capacity.amps), capacity.tier),
            ),
        [edit],
    );

    // One-shot import of prefs-era GT labels - remove in a later release.
    const { legacyGTLabels, clearLegacyGTLabels } = usePrefs();
    const importing = useRef(false);
    useEffect(() => {
        if (!legacyGTLabels || !labelsPoll.data || importing.current) return;
        importing.current = true;
        importLegacyLabels(legacyGTLabels, toLabels(labelsPoll.data))
            .then(() => {
                clearLegacyGTLabels();
                refresh();
            })
            .catch(() => {})
            .finally(() => {
                importing.current = false;
            });
    }, [legacyGTLabels, labelsPoll.data, clearLegacyGTLabels, refresh]);

    const holdFastMachinesPoll = useCallback(() => {
        setFastHolders((n) => n + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            setFastHolders((n) => n - 1);
        };
    }, []);

    const value = useMemo<GTContextValue>(
        () => ({
            enabled,
            machines,
            problemCount,
            holdFastMachinesPoll,
            nonce,
            refresh,
            ...labels,
            setMachineName,
            setMachineLine,
            renameLine,
            setTunnelCapacity,
        }),
        [
            enabled,
            machines,
            problemCount,
            holdFastMachinesPoll,
            nonce,
            refresh,
            labels,
            setMachineName,
            setMachineLine,
            renameLine,
            setTunnelCapacity,
        ],
    );

    return <GTContext.Provider value={value}>{children}</GTContext.Provider>;
}

/** Polls machines at the scan rate while `active` - for views showing live machine progress. */
export function useFastMachinesPoll(active: boolean): void {
    const { holdFastMachinesPoll } = useGT();
    useEffect(() => (active ? holdFastMachinesPoll() : undefined), [active, holdFastMachinesPoll]);
}

export function useGT(): GTContextValue {
    const ctx = useContext(GTContext);
    if (!ctx) throw new Error("useGT must be used within a GTProvider");
    return ctx;
}
