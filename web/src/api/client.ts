import type {
    CpuDetail,
    CpuList,
    DetailedItem,
    Envelope,
    GridKey,
    GridSettingsResult,
    GridSummary,
    GTMachineDetail,
    GTMachines,
    GTPower,
    GTPowerHistory,
    GTFlow,
    GTProduction,
    GTProductionHistory,
    GTRange,
    ItemHistoryResult,
    JobData,
    OrderResult,
    PrefsResult,
    StatsRange,
    TrackingDetail,
    TrackingHistoryElement,
} from "./types";

/** Thrown for any envelope whose `status` isn't `"OK"`. `status` is the server's error code. */
export class ApiError extends Error {
    constructor(
        public readonly status: string,
        public readonly payload: unknown,
    ) {
        super(payload == null ? status : `${status}: ${JSON.stringify(payload)}`);
        this.name = "ApiError";
    }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Every endpoint lives under `api/`, relative to the page so the panel keeps working below a reverse
 * proxy's sub-path. Errors come back as a non-2xx status carrying the same `{status, data}` envelope, so
 * the envelope - not the HTTP status - decides success.
 */
async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        // The router refuses a cookie-authenticated mutation without this marker (CSRF protection).
        headers["X-AE2-Request"] = "true";
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`api/${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
        // The session token expired or was revoked elsewhere: back to the login page instead of leaving
        // the SPA stuck on a generic error toast. Never loops: login.html issues no API calls of its own.
        clearBrowserSession();
        return new Promise<T>(() => {}); // navigation is about to tear this page down
    }
    let envelope: Envelope<T>;
    try {
        envelope = (await res.json()) as Envelope<T>;
    } catch {
        throw new ApiError(`HTTP_${res.status}`, null);
    }
    if (envelope.status !== "OK") {
        throw new ApiError(envelope.status, envelope.data);
    }
    return envelope.data;
}

function apiGet<T>(path: string): Promise<T> {
    return apiRequest("GET", path);
}

function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value));
    }
    const s = search.toString();
    return s ? `?${s}` : "";
}

const seg = encodeURIComponent;

function grid(gridKey: GridKey): string {
    return `grids/${seg(gridKey)}`;
}

export function getGrids(): Promise<GridSummary[]> {
    return apiGet("grids");
}

export function getItems(gridKey: GridKey): Promise<DetailedItem[]> {
    return apiGet(`${grid(gridKey)}/items`);
}

export function getCpuList(gridKey: GridKey): Promise<CpuList> {
    return apiGet(`${grid(gridKey)}/cpus`);
}

export function getCpu(gridKey: GridKey, cpuKey: string): Promise<CpuDetail> {
    return apiGet(`${grid(gridKey)}/cpus/${seg(cpuKey)}`);
}

export function cancelCpu(gridKey: GridKey, cpuKey: string): Promise<null> {
    return apiRequest("POST", `${grid(gridKey)}/cpus/${seg(cpuKey)}/cancel`);
}

/** Starts a crafting calculation; poll it with `getJob` until `isDone`. */
export function order(gridKey: GridKey, itemKey: string, quantity: number): Promise<OrderResult> {
    return apiRequest("POST", `${grid(gridKey)}/crafting-plans`, { itemKey, quantity });
}

export function getJob(gridKey: GridKey, jobId: number): Promise<JobData> {
    return apiGet(`${grid(gridKey)}/crafting-plans/${jobId}`);
}

export function cancelJob(gridKey: GridKey, jobId: number): Promise<null> {
    return apiRequest("DELETE", `${grid(gridKey)}/crafting-plans/${jobId}`);
}

/**
 * `cancelJob` for a `pagehide` handler: `keepalive` lets the request outlive the page. Not `sendBeacon`,
 * which can only POST and can't carry the CSRF marker. Fire-and-forget - the page is going away.
 */
export function cancelJobOnUnload(gridKey: GridKey, jobId: number): void {
    void fetch(`api/${grid(gridKey)}/crafting-plans/${jobId}`, {
        method: "DELETE",
        credentials: "same-origin",
        keepalive: true,
        headers: { "X-AE2-Request": "true" },
    }).catch(() => {});
}

/** `cpuKey` undefined lets AE2 pick any free CPU. */
export function submitJob(gridKey: GridKey, jobId: number, cpuKey?: string): Promise<null> {
    return apiRequest("POST", `${grid(gridKey)}/crafting-plans/${jobId}/submit`, cpuKey ? { cpuKey } : {});
}

export function getTrackingHistory(gridKey: GridKey): Promise<TrackingHistoryElement[]> {
    return apiGet(`${grid(gridKey)}/crafting-history`);
}

export function getTracking(gridKey: GridKey, id: number): Promise<TrackingDetail> {
    return apiGet(`${grid(gridKey)}/crafting-history/${id}`);
}

export function setGridTracking(gridKey: GridKey, track: boolean): Promise<GridSettingsResult> {
    return apiRequest("PATCH", `${grid(gridKey)}/settings`, { isTracked: track });
}

/** Every item of a grid is sampled server-side; `items` (1-50 itemids) picks which series come back. */
export function getItemHistory(
    gridKey: GridKey,
    range: StatsRange,
    points: number,
    items: string[],
    customMinutes?: number,
): Promise<ItemHistoryResult> {
    return apiGet(
        `${grid(gridKey)}/item-history${query({
            range,
            points,
            items: items.join(","),
            minutes: range === "custom" ? customMinutes : undefined,
        })}`,
    );
}

/** Prefs follow the logged-in principal, not any one grid. */
export function getPrefs(): Promise<PrefsResult> {
    return apiGet("prefs");
}

/** `blob` is opaque to the server - whatever `state/prefs.tsx` last serialized. */
export function setPrefs(blob: string): Promise<PrefsResult> {
    return apiRequest("PUT", "prefs", { blob });
}

// GregTech hub (docs/gt-hub/phase-1-core.md §5). Like prefs these aren't grid-scoped - visibility is per
// machine owner. A server without a GT provider answers every one of them `NOT_AVAILABLE` (see
// `isGTNotAvailable`).

/** `minutes` only travels with `range === "custom"`, same as `getItemHistory`. */
function gtRange(range: GTRange, minutes?: number) {
    return { range, minutes: range === "custom" ? minutes : undefined };
}

export function getGTMachines(): Promise<GTMachines> {
    return apiGet("gt/machines");
}

export function getGTMachine(id: string, range: GTRange, minutes?: number): Promise<GTMachineDetail> {
    return apiGet(`gt/machines/${seg(id)}${query(gtRange(range, minutes))}`);
}

export function getGTPower(): Promise<GTPower> {
    return apiGet("gt/power");
}

export function getGTPowerHistory(
    source: string,
    range: GTRange,
    points: number,
    minutes?: number,
): Promise<GTPowerHistory> {
    return apiGet(`gt/power/${seg(source)}/history${query({ points, ...gtRange(range, minutes) })}`);
}

export function getGTProduction(
    range: GTRange,
    groupBy: "item" | "machine",
    flow: GTFlow,
    machine?: string,
    minutes?: number,
): Promise<GTProduction> {
    return apiGet(`gt/production${query({ groupBy, flow, machine, ...gtRange(range, minutes) })}`);
}

export function getGTProductionHistory(opts: {
    item?: string;
    machine?: string;
    flow: GTFlow;
    range: GTRange;
    points: number;
    minutes?: number;
}): Promise<GTProductionHistory> {
    const { item, machine, flow, range, points, minutes } = opts;
    return apiGet(`gt/production/history${query({ item, machine, flow, points, ...gtRange(range, minutes) })}`);
}

/** The server has no GregTech provider (or `gt_enabled=false`) - an empty state, never an error toast. */
export function isGTNotAvailable(e: unknown): boolean {
    return e instanceof ApiError && e.status === "NOT_AVAILABLE";
}

let clearingSession = false;

/**
 * Drops the browser's session cookie and lands on the login page, via a same-origin form POST of
 * `clearSession=true`. A plain reload is not enough behind `example_website/index.php`: it keeps serving
 * the terminal for as long as its own cookie exists, and only expires it for this form. The mod's own
 * server needs no form - it expires a cookie whose token is no longer valid on any page load - but treats
 * the POST as one.
 */
function clearBrowserSession(): void {
    if (clearingSession) return;
    clearingSession = true;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = ".";
    form.hidden = true;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "clearSession";
    field.value = "true";
    form.appendChild(field);
    document.body.appendChild(form);
    form.submit();
}

/** Revokes the session server-side, then clears it in the browser. */
export async function logout(): Promise<void> {
    try {
        await apiRequest("POST", "auth/logout");
    } finally {
        clearBrowserSession();
    }
}

/**
 * URL for an item/fluid's icon, looked up server-side by itemid in IconHandler's ItemIconIndex - see
 * ItemIcon.tsx for the fetch/fallback logic around this. A 404 means the icon export has no such
 * item; the caller is expected to fall back to the generated placeholder tile, not treat it as an error.
 */
export function iconUrl(itemid: string): string {
    return `icon${query({ id: itemid })}`;
}
