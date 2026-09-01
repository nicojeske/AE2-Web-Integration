// Hash routing for the shell (M11). Kept deliberately small: a `Section`, an optional `grid` selection
// so a link carries the network too, and at most one addressable detail overlay (a busy CPU's Craft
// Detail, or a Crafting History record). The order/plan flow is NOT addressable - `flow.previewing` is
// server-side job state (a computed-but-not-submitted plan) that must never be re-entered from a URL, so
// it stays local state in `state/order.tsx`, same as before this milestone.
//
// URL shapes:
//   #/browser?grid=3        #/jobs                  #/jobs/cpu/3/CPU%20%231
//   #/history                #/history/3/482         #/favorites?grid=3     #/stats?grid=all
import { useCallback, useEffect, useState } from "preact/hooks";

import type { GridSelection } from "../state/network";
import type { Section } from "./section";

export type RouteDetail =
    { type: "cpu"; gridId: number; cpuName: string } | { type: "history"; gridId: number; id: number } | null;

export interface Route {
    section: Section;
    /** `null` when the URL carries no `?grid=` - the caller falls back to the persisted selection. */
    grid: GridSelection | null;
    detail: RouteDetail;
}

const SECTIONS: readonly Section[] = ["browser", "jobs", "history", "favorites", "stats"];

function isSection(value: string): value is Section {
    return (SECTIONS as readonly string[]).includes(value);
}

function parseGridParam(raw: string | null): GridSelection | null {
    if (raw === null) return null;
    if (raw === "all") return "all";
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/** Pure - exported for tests and for `buildHash`'s "does this already match" comparisons. */
export function parseHash(hash: string): Route {
    const withoutLeadingHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const [pathPart, queryPart] = withoutLeadingHash.split("?");
    const segments = (pathPart ?? "")
        .split("/")
        .filter((s) => s.length > 0)
        .map(decodeURIComponent);

    const section = isSection(segments[0] ?? "") ? (segments[0] as Section) : "browser";
    const grid = parseGridParam(new URLSearchParams(queryPart ?? "").get("grid"));

    let detail: RouteDetail = null;
    if (section === "jobs" && segments[1] === "cpu" && segments.length >= 4) {
        const gridId = Number(segments[2]);
        const cpuName = segments[3];
        if (Number.isFinite(gridId) && cpuName !== undefined) detail = { type: "cpu", gridId, cpuName };
    } else if (section === "history" && segments.length >= 3) {
        const gridId = Number(segments[1]);
        const id = Number(segments[2]);
        if (Number.isFinite(gridId) && Number.isFinite(id)) detail = { type: "history", gridId, id };
    }

    return { section, grid, detail };
}

export function buildHash(route: Route): string {
    let path = `/${route.section}`;
    if (route.detail?.type === "cpu") {
        path += `/cpu/${route.detail.gridId}/${encodeURIComponent(route.detail.cpuName)}`;
    } else if (route.detail?.type === "history") {
        path += `/${route.detail.gridId}/${route.detail.id}`;
    }
    const query = route.grid !== null ? `?grid=${route.grid === "all" ? "all" : route.grid}` : "";
    return `#${path}${query}`;
}

function currentRoute(): Route {
    return parseHash(window.location.hash);
}

export interface RouteApi extends Route {
    /**
     * Rewrites the current entry in place (no new history entry) - grid-selection mirroring and
     * normalizing a malformed hash both use this, since neither is a user-meaningful "place I was".
     */
    replace: (next: Partial<Route>) => void;
    /** Pushes a new history entry - section/detail navigation, so Back returns to where you were. */
    push: (next: Partial<Route>) => void;
}

/**
 * `hashchange` also fires for `replace`'s own `history.replaceState` calls in every browser tested, but
 * relying on that isn't safe (Safari has historically not fired it for `replaceState`) - `replace` sets
 * local state directly rather than waiting on the event, same reasoning as `cpus.tsx`'s "latest ref"
 * pattern: don't assume an external event covers a change this hook itself just made.
 */
export function useRoute(): RouteApi {
    const [route, setRoute] = useState<Route>(() => currentRoute());

    useEffect(() => {
        const onHashChange = () => setRoute(currentRoute());
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    const push = useCallback((next: Partial<Route>) => {
        const merged: Route = { ...currentRoute(), ...next };
        const hash = buildHash(merged);
        if (hash === window.location.hash) return;
        window.location.hash = hash; // triggers `hashchange` -> setRoute, so a Back/Forward through it works
    }, []);

    const replace = useCallback((next: Partial<Route>) => {
        const merged: Route = { ...currentRoute(), ...next };
        const hash = buildHash(merged);
        if (hash !== window.location.hash) history.replaceState(null, "", hash);
        setRoute(merged);
    }, []);

    return { ...route, replace, push };
}
