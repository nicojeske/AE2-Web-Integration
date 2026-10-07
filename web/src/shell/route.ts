// Hash routing for the shell (M11). Kept deliberately small: a `Section`, an optional `grid` selection
// so a link carries the network too, and at most one addressable detail overlay (a busy CPU's Craft
// Detail, or a Crafting History record). The order/plan flow is NOT addressable - `flow.previewing` is
// server-side job state (a computed-but-not-submitted plan) that must never be re-entered from a URL, so
// it stays local state in `state/order.tsx`, same as before this milestone.
//
// URL shapes:
//   #/browser?grid=<key>    #/jobs                  #/jobs/cpu/<gridKey>/<cpuKey>
//   #/history                #/history/<gridKey>/482 #/favorites?grid=<key> #/stats?grid=all
//   #/machines               #/machines/0%3A120%3A64%3A-340                 #/power   #/production
//
// The GregTech sections aren't grid-scoped, so `buildHash` never writes `?grid=` for them and
// `parseHash` ignores one if present.
import { useCallback, useEffect, useState } from "preact/hooks";

import type { GridSelection } from "../state/network";
import type { Section } from "./section";
import { isGTSection } from "./section";
import type { GridKey } from "../api/types";

export type RouteDetail =
    | { type: "cpu"; gridKey: GridKey; cpuKey: string }
    | { type: "history"; gridKey: GridKey; id: number }
    | { type: "machine"; id: string }
    | null;

export interface Route {
    section: Section;
    /** `null` when the URL carries no `?grid=` - the caller falls back to the persisted selection. */
    grid: GridSelection | null;
    detail: RouteDetail;
}

const SECTIONS: readonly Section[] = [
    "browser",
    "jobs",
    "history",
    "favorites",
    "stats",
    "machines",
    "power",
    "production",
];

function isSection(value: string): value is Section {
    return (SECTIONS as readonly string[]).includes(value);
}

function parseGridParam(raw: string | null): GridSelection | null {
    return raw === null || raw === "" ? null : raw;
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
    const grid = isGTSection(section) ? null : parseGridParam(new URLSearchParams(queryPart ?? "").get("grid"));

    let detail: RouteDetail = null;
    if (section === "jobs" && segments[1] === "cpu" && segments.length >= 4) {
        const gridKey = segments[2];
        const cpuKey = segments[3];
        if (gridKey && cpuKey) detail = { type: "cpu", gridKey, cpuKey };
    } else if (section === "history" && segments.length >= 3) {
        const gridKey = segments[1];
        const id = Number(segments[2]);
        if (gridKey && Number.isFinite(id)) detail = { type: "history", gridKey, id };
    } else if (section === "machines" && segments[1]) {
        detail = { type: "machine", id: segments[1] };
    }

    return { section, grid, detail };
}

export function buildHash(route: Route): string {
    let path = `/${route.section}`;
    if (route.detail?.type === "cpu") {
        path += `/cpu/${encodeURIComponent(route.detail.gridKey)}/${encodeURIComponent(route.detail.cpuKey)}`;
    } else if (route.detail?.type === "history") {
        path += `/${encodeURIComponent(route.detail.gridKey)}/${route.detail.id}`;
    } else if (route.detail?.type === "machine") {
        path += `/${encodeURIComponent(route.detail.id)}`;
    }
    const query = route.grid !== null && !isGTSection(route.section) ? `?grid=${encodeURIComponent(route.grid)}` : "";
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
