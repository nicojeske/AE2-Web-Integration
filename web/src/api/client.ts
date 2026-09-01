import type {
    CpuDetail,
    CpuList,
    DetailedItem,
    Envelope,
    GridSettingsResult,
    GridSummary,
    ItemHistoryResult,
    JobData,
    OrderResult,
    PrefsResult,
    StatsRange,
    TrackedItemsResult,
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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, { credentials: "same-origin", ...init });
    if (res.status === 401) {
        // The session token expired or was revoked elsewhere (preHTTPHandler answers a bare 401 with
        // no body - AE2Controller.java). A page navigation would land back on login.html for the same
        // condition; do the same here instead of leaving the SPA stuck on a generic error toast. Never
        // loops: login.html issues no API calls of its own.
        window.location.href = ".";
        return new Promise<T>(() => {}); // navigation is about to tear this page down
    }
    if (!res.ok) {
        throw new ApiError(`HTTP_${res.status}`, await res.text().catch(() => null));
    }
    const envelope = (await res.json()) as Envelope<T>;
    if (envelope.status !== "OK") {
        throw new ApiError(envelope.status, envelope.data);
    }
    return envelope.data;
}

function apiGet<T>(path: string): Promise<T> {
    return apiRequest(path);
}

function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value));
    }
    const s = search.toString();
    return s ? `?${s}` : "";
}

/**
 * The async endpoints (trackinghistory / gettracking / gridsettings) authorize against a per-user
 * access set the server rebuilds during synced requests. After a long idle period it expires and the
 * server answers REFRESH_REQUIRED instead of serving the request. Fetching the grid list is a synced
 * request that rebuilds that set, so retry once through it before surfacing an error - ported from the
 * old webpage.html's getJSONWithGridRefresh.
 */
async function withGridRefresh<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        if (e instanceof ApiError && e.status === "REFRESH_REQUIRED") {
            await getGrids();
            return run();
        }
        throw e;
    }
}

export function getGrids(): Promise<GridSummary[]> {
    return apiGet("grids");
}

export function getItems(gridId: number): Promise<DetailedItem[]> {
    return apiGet(`items${query({ grid: gridId })}`);
}

export function getCpuList(gridId: number): Promise<CpuList> {
    return apiGet(`list${query({ grid: gridId })}`);
}

export function getCpu(gridId: number, cpuName: string): Promise<CpuDetail> {
    return apiGet(`get${query({ grid: gridId, cpu: cpuName })}`);
}

export function cancelCpu(gridId: number, cpuName: string): Promise<null> {
    return apiGet(`cancelcpu${query({ grid: gridId, cpu: cpuName })}`);
}

export function order(gridId: number, itemHashcode: number, quantity: number): Promise<OrderResult> {
    return apiGet(`order${query({ grid: gridId, item: itemHashcode, quantity })}`);
}

export function getJob(gridId: number, jobId: number): Promise<JobData> {
    return apiGet(`job${query({ grid: gridId, id: jobId })}`);
}

export function cancelJob(gridId: number, jobId: number): Promise<null> {
    return apiGet(`job${query({ grid: gridId, id: jobId, cancel: "" })}`);
}

export function submitJob(gridId: number, jobId: number, cpuName: string): Promise<null> {
    return apiGet(`job${query({ grid: gridId, id: jobId, submit: "", cpu: cpuName })}`);
}

export function getTrackingHistory(gridId: number): Promise<TrackingHistoryElement[]> {
    return withGridRefresh(() => apiGet(`trackinghistory${query({ grid: gridId })}`));
}

export function getTracking(gridId: number, id: number): Promise<TrackingDetail> {
    return withGridRefresh(() => apiGet(`gettracking${query({ grid: gridId, id })}`));
}

export function setGridTracking(gridId: number, track: boolean): Promise<GridSettingsResult> {
    return withGridRefresh(() => apiGet(`gridsettings${query({ grid: gridId, track: track ? "1" : "0" })}`));
}

/**
 * Omitting `items` asks the server for its own tracked set - the fetch strategy this client uses
 * everywhere, to avoid ever sending a client-side tracked-item list that could drift from the server's.
 */
export function getItemHistory(
    gridId: number,
    range: StatsRange,
    points: number,
    items?: string[],
    customMinutes?: number,
): Promise<ItemHistoryResult> {
    return withGridRefresh(() =>
        apiGet(
            `itemhistory${query({
                grid: gridId,
                range,
                points,
                items: items?.join(","),
                minutes: range === "custom" ? customMinutes : undefined,
            })}`,
        ),
    );
}

export function getTrackedItems(gridId: number): Promise<TrackedItemsResult> {
    return withGridRefresh(() => apiGet(`trackeditems${query({ grid: gridId })}`));
}

export function setTrackedItems(gridId: number, items: string[]): Promise<TrackedItemsResult> {
    return withGridRefresh(() => apiGet(`trackeditems${query({ grid: gridId, set: items.join(",") })}`));
}

export function addTrackedItem(gridId: number, itemid: string): Promise<TrackedItemsResult> {
    return withGridRefresh(() => apiGet(`trackeditems${query({ grid: gridId, add: itemid })}`));
}

export function removeTrackedItem(gridId: number, itemid: string): Promise<TrackedItemsResult> {
    return withGridRefresh(() => apiGet(`trackeditems${query({ grid: gridId, remove: itemid })}`));
}

/**
 * `/prefs` isn't grid-scoped (it follows the logged-in principal, not any one grid), so unlike every
 * other endpoint here it takes no `withGridRefresh` wrapper and no `grid` param.
 * <p>
 * Both calls are POST - the server tells a read from a write by body presence, not HTTP method (see
 * `PlayerPrefsHandler.java`), and the Fetch spec disallows a body on GET at all.
 */
export function getPrefs(): Promise<PrefsResult> {
    return apiRequest("prefs", { method: "POST" });
}

/** `blob` is opaque to the server - whatever `state/prefs.tsx` last serialized. */
export function setPrefs(blob: string): Promise<PrefsResult> {
    return apiRequest("prefs", { method: "POST", body: blob });
}

export function logout(): void {
    window.location.href = "?logout";
}

/**
 * URL for an item/fluid's icon, matched server-side by (already §-stripped) display name against
 * AE2Controller's ItemIconIndex - see ItemIcon.tsx for the fetch/fallback logic around this. A 404
 * means no match; the caller is expected to fall back to the generated placeholder tile, not treat it
 * as an error.
 */
export function iconUrl(plainName: string): string {
    return `icon${query({ name: plainName })}`;
}
