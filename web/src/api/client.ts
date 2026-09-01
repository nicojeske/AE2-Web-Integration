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

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: "same-origin" });
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

export function logout(): void {
    window.location.href = "?logout";
}
