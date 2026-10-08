import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import type { GTRange, StatsRange } from "../api/types.ts";

import {
    createJob,
    findGrid,
    findItemByKey,
    MOCK_HOURLY_RETENTION_DAYS,
    MOCK_TRACKED_LIMIT,
    mockGrids,
    mockItemHistory,
    mockCpuKey,
    mockJobs,
    recordTracking,
    settleCompletedJobs,
    toCompactedItems,
    toCpuList,
    toGridSummaries,
    toJobData,
    trackedItemNames,
} from "./fixtures.ts";
import type { MockGrid } from "./fixtures.ts";
import {
    findMockMachine,
    hasMockPowerSource,
    MOCK_POWER_MAX_RANGE,
    MOCK_PRODUCTION_MAX_RANGE,
    mockGTMachines,
    mockGTPower,
    mockGTPowerHistory,
    mockGTProduction,
    mockGTProductionHistory,
    parseGTRange,
    parsePoints,
} from "./gtFixtures.ts";

const STATS_RANGES = new Set<StatsRange>(["15m", "1h", "6h", "24h", "7d", "30d", "1y", "all", "custom"]);
const MAX_HISTORY_POINTS = 500;
const DEFAULT_HISTORY_POINTS = 120;
const MAX_TRACKED_ITEMID_LENGTH = 256;

// Mirrors ItemIconIndex.java's matching rules (never committed to the repo - see .gitignore and
// CLAUDE.md - so this directory is expected to be missing for most contributors, which is fine: the
// feature just stays off, same as an unconfigured item_icon_directory server-side).
const ICON_DIR = fileURLToPath(new URL("../../../ae2webintegration_icons", import.meta.url));

/** Port of `IconFileNames.fileName` (core/icons): the exporter's `<encoded itemid>.png`. */
function iconFileName(itemid: string): string {
    let out = "";
    for (const byte of new TextEncoder().encode(itemid)) {
        const c = String.fromCharCode(byte);
        if (c === ":") out += "~";
        else if (/[A-Za-z0-9._-]/.test(c)) out += c;
        else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    return out + ".png";
}

/**
 * GregTech hub mode: `"1"` (default) = a server with GT, `"0"` = without one (sections hidden, every
 * `/gt/*` answers NOT_AVAILABLE), `"na"` = GT went away after the page loaded (sections shown, endpoints
 * NOT_AVAILABLE - the empty states). Env `MOCK_GT` sets the default; a `?gt=` on the page URL overrides it
 * for that tab, read back off API calls' Referer.
 */
type GTMode = "1" | "0" | "na";

function gtMode(pageUrl: string | undefined): GTMode {
    const fromPage = pageUrl ? new URL(pageUrl, "http://localhost").searchParams.get("gt") : null;
    const raw = fromPage ?? process.env.MOCK_GT ?? "1";
    return raw === "0" || raw === "na" ? raw : "1";
}

/** Stands in for `CoreData`'s per-principal blob map - a single slot is fine since the mock server only
 *  ever serves one (dev) principal. */
let mockPrefsBlob: string | null = null;

/** Lazily checked once per dev-server run - the directory doesn't change without a restart either. */
let hasIconDir: boolean | undefined;
function hasIcons(): boolean {
    hasIconDir ??= existsSync(ICON_DIR) && readdirSync(ICON_DIR).some((file) => file.endsWith(".png"));
    return hasIconDir;
}

/** HTTP status per API status, as `ApiStatus.java` maps them - the envelope still carries the status. */
const HTTP_STATUS: Record<string, number> = {
    OK: 200,
    BAD_PARAM: 400,
    INVALID_QUANTITY: 400,
    NO_PERMISSIONS: 403,
    CSRF_REJECTED: 403,
    GRID_NOT_FOUND: 404,
    CPU_NOT_FOUND: 404,
    ITEM_NOT_FOUND: 404,
    TRACKING_NOT_FOUND: 404,
    INVALID_ID: 404,
    NOT_FOUND: 404,
    NOT_AVAILABLE: 404,
    METHOD_NOT_ALLOWED: 405,
};

function respond(res: ServerResponse, status: string, data: unknown, httpStatus?: number): void {
    res.statusCode = httpStatus ?? HTTP_STATUS[status] ?? 409;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ status, data }));
}

function ok(res: ServerResponse, data: unknown): void {
    respond(res, "OK", data);
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

/** The request's JSON body, or `{}` when it has none or it isn't an object. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await readBody(req);
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * Mocks WebHandler's native-form-POST-to-"/" login/register flow (302 redirects, no {status,data}
 * envelope - the JSON /api/auth endpoints set no cookie, so login.html isn't a fetch() client). Password rules are dev-only conveniences, not a real auth check: password "password" always
 * succeeds, username "baduser" is "unknown", register username "offline" is "not online".
 */
async function handleLoginPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = new URLSearchParams(await readBody(req));
    const redirect = (location: string) => {
        res.statusCode = 302;
        res.setHeader("Location", location);
        res.end();
    };

    if (body.get("clearSession") === "true") {
        res.setHeader("Set-Cookie", "authenticationToken=; Path=/; Max-Age=0; HttpOnly");
        redirect(".");
        return;
    }

    if (body.has("register") && body.has("password")) {
        const username = body.get("register") ?? "";
        if (username.trim().toLowerCase() === "offline") {
            redirect("?NOT_ONLINE");
            return;
        }
        redirect(`?confirmregistration&token=${"mockconfirmationtoken1234567890"}`);
        return;
    }

    if (body.has("username") && body.has("password")) {
        const username = body.get("username") ?? "";
        const password = body.get("password") ?? "";
        if (username.trim().toLowerCase() === "baduser") {
            redirect("?INVALID_USER");
            return;
        }
        if (password !== "password" && username.trim().toLowerCase() !== "admin") {
            redirect("?INVALID_PASSWORD");
            return;
        }
        res.setHeader("Set-Cookie", "authenticationToken=mock-dev-token; Path=/; HttpOnly");
        redirect(".");
        return;
    }

    res.statusCode = 400;
    res.end();
}

/** `/api/gt/*` - mirrors the `GetGT*` endpoints' params, defaults and error statuses. */
function handleGT(path: string[], params: URLSearchParams, mode: GTMode, res: ServerResponse, next: () => void): void {
    if (mode !== "1" || params.get("fail") === "NOT_AVAILABLE") return respond(res, "NOT_AVAILABLE", null);
    const now = Date.now();
    const range = (fallback: GTRange, max: number) =>
        parseGTRange(params.get("range"), params.get("minutes"), fallback, max);
    const [section, id, sub] = path;

    if (section === "machines" && id === undefined) return ok(res, mockGTMachines(now));
    if (section === "machines" && id !== undefined && sub === undefined) {
        const span = range("24h", MOCK_PRODUCTION_MAX_RANGE);
        if (span === null) return respond(res, "BAD_PARAM", null);
        const machine = findMockMachine(id, now);
        if (!machine) return respond(res, "NOT_FOUND", null);
        return ok(res, { machine, production: mockGTProduction(span, "item", id, now) });
    }
    if (section === "power" && id === undefined) return ok(res, { sources: mockGTPower(now) });
    if (section === "power" && id !== undefined && sub === "history") {
        const span = range("24h", MOCK_POWER_MAX_RANGE);
        const points = parsePoints(params.get("points"));
        if (span === null || points === null) return respond(res, "BAD_PARAM", null);
        if (!hasMockPowerSource(id)) return respond(res, "NOT_FOUND", null);
        return ok(res, mockGTPowerHistory(id, span, points, now));
    }
    if (section === "production" && id === undefined) {
        const span = range("24h", MOCK_PRODUCTION_MAX_RANGE);
        const groupBy = params.get("groupBy") ?? "item";
        if (span === null || (groupBy !== "item" && groupBy !== "machine")) {
            return respond(res, "BAD_PARAM", null);
        }
        return ok(res, mockGTProduction(span, groupBy, params.get("machine"), now));
    }
    if (section === "production" && id === "history") {
        const span = range("7d", MOCK_PRODUCTION_MAX_RANGE);
        const points = parsePoints(params.get("points"));
        if (span === null || points === null) return respond(res, "BAD_PARAM", null);
        return ok(res, mockGTProductionHistory(params.get("item"), params.get("machine"), span, points, now));
    }
    next();
}

/** `/api/...` below `/api/gt` - mirrors the `@Endpoint` classes' routes, inputs and statuses. */
async function handleApi(
    method: string,
    path: string[],
    params: URLSearchParams,
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
): Promise<void> {
    for (const g of mockGrids) settleCompletedJobs(g);
    const route = `${method} ${path.map((p, i) => (path[0] === "grids" && i === 1 ? "{grid}" : p)).join("/")}`;

    if (path[0] === "gt") return handleGT(path.slice(1), params, gtMode(req.headers.referer), res, next);
    if (route === "GET grids") return ok(res, toGridSummaries());
    if (route === "POST auth/logout") return ok(res, null);
    if (route === "GET prefs") return ok(res, { blob: mockPrefsBlob });
    if (route === "PUT prefs") {
        const body = await readJson(req);
        if (typeof body.blob !== "string") return respond(res, "BAD_PARAM", null);
        mockPrefsBlob = body.blob;
        return ok(res, { blob: mockPrefsBlob });
    }
    if (path[0] !== "grids" || path[1] === undefined) return next();

    const grid = findGrid(path[1]);
    if (!grid) return respond(res, "GRID_NOT_FOUND", null);
    const [, , resource, id, action] = path;

    switch (`${method} ${resource}${id === undefined ? "" : "/{id}"}${action === undefined ? "" : `/${action}`}`) {
        case "GET items":
            return ok(res, grid.items);
        case "GET cpus":
            return ok(res, toCpuList(grid));
        case "GET cpus/{id}": {
            const busy = grid.busyCpus.find((c) => mockCpuKey(c.name) === id);
            if (busy) {
                // GetCPU.java only sets timeStarted/timeElapsed inside its hasTrackingInfo branch - an
                // untracked busy CPU reports neither.
                return ok(res, {
                    size: busy.availableStorage,
                    isBusy: true,
                    finalOutput: busy.output,
                    items: toCompactedItems(busy),
                    hasTrackingInfo: busy.hasTrackingInfo,
                    timeStarted: busy.hasTrackingInfo ? busy.startedAt : 0,
                    timeElapsed: busy.hasTrackingInfo ? Date.now() - busy.startedAt : 0,
                });
            }
            const idle = grid.idleCpus.find((c) => mockCpuKey(c.name) === id);
            if (!idle) return respond(res, "CPU_NOT_FOUND", null);
            // GetCPU.java skips its whole busy block for an idle CPU, so `items` comes back `null`.
            return ok(res, {
                size: idle.availableStorage,
                isBusy: false,
                finalOutput: null,
                items: null,
                hasTrackingInfo: false,
                timeStarted: 0,
                timeElapsed: 0,
            });
        }
        case "POST cpus/{id}/cancel": {
            const idx = grid.busyCpus.findIndex((c) => mockCpuKey(c.name) === id);
            if (idx === -1) return respond(res, "CPU_NOT_BUSY", null);
            const cancelled = grid.busyCpus.splice(idx, 1)[0]!;
            recordTracking(grid, cancelled, true);
            grid.idleCpus.push({
                name: cancelled.name,
                coProcessors: cancelled.coProcessors,
                availableStorage: cancelled.availableStorage,
            });
            return ok(res, null);
        }
        case "POST crafting-plans": {
            const body = await readJson(req);
            const quantity = Number(body.quantity);
            if (typeof body.itemKey !== "string") return respond(res, "BAD_PARAM", null);
            if (!Number.isInteger(quantity) || quantity < 1) return respond(res, "INVALID_QUANTITY", null);
            const found = findItemByKey(body.itemKey);
            if (!found || !found.item.craftable) return respond(res, "ITEM_NOT_FOUND", null);
            if (grid.idleCpus.length === 0) return respond(res, "ALL_CPU_BUSY", null);
            return respond(res, "OK", { jobID: createJob(grid.key, body.itemKey, quantity).id }, 202);
        }
        case "GET crafting-plans/{id}": {
            const job = mockJobs.get(Number(id));
            return job ? ok(res, toJobData(job)) : respond(res, "INVALID_ID", null);
        }
        case "DELETE crafting-plans/{id}":
            return mockJobs.delete(Number(id)) ? ok(res, null) : respond(res, "INVALID_ID", null);
        case "POST crafting-plans/{id}/submit": {
            const jobId = Number(id);
            const job = mockJobs.get(jobId);
            if (!job) return respond(res, "INVALID_ID", null);
            const data = toJobData(job);
            if (!data.isDone) return respond(res, "JOB_NOT_DONE", null);
            const body = await readJson(req);
            const cpuKey = typeof body.cpuKey === "string" ? body.cpuKey : undefined;
            const idleIdx = cpuKey
                ? grid.idleCpus.findIndex((c) => mockCpuKey(c.name) === cpuKey)
                : grid.idleCpus.length > 0
                  ? 0
                  : -1;
            const busyCpu = cpuKey ? grid.busyCpus.find((c) => mockCpuKey(c.name) === cpuKey) : undefined;
            if (idleIdx === -1 && !busyCpu) return respond(res, "CPU_NOT_FOUND", null);
            const itemMatch = findItemByKey(job.itemKey);
            const outputItemid = itemMatch?.item.itemid ?? "unknown";

            if (busyCpu) {
                // Merge into an already-busy CPU crafting the same output - the real AE2CraftingGrid.submitJob
                // would refuse a genuine output mismatch even if a stale client somehow posted one (the
                // UI's own row validation is what normally prevents this from ever being reachable).
                if (busyCpu.output.itemid !== outputItemid) {
                    return respond(res, "FAIL", "Target CPU is crafting a different item");
                }
                busyCpu.usedStorage =
                    (busyCpu.usedStorage === -1 ? 0 : busyCpu.usedStorage) + Math.round(data.bytesTotal);
                busyCpu.craftDurationMs += 20_000;
            } else {
                const cpu = grid.idleCpus.splice(idleIdx, 1)[0]!;
                grid.busyCpus.push({
                    name: cpu.name,
                    coProcessors: cpu.coProcessors,
                    availableStorage: cpu.availableStorage,
                    usedStorage: Math.round(data.bytesTotal),
                    output: {
                        itemid: outputItemid,
                        itemname: itemMatch?.item.itemname ?? "Unknown",
                        itemKey: job.itemKey,
                        quantity: job.quantity,
                    },
                    startedAt: Date.now(),
                    craftDurationMs: 60_000,
                    hasTrackingInfo: grid.isTrackingEnabled,
                    recipe: [
                        {
                            itemid: outputItemid,
                            itemname: itemMatch?.item.itemname ?? "Unknown",
                            requested: job.quantity,
                            stored: itemMatch?.item.quantity ?? 0,
                        },
                    ],
                });
            }
            mockJobs.delete(jobId);
            return ok(res, null);
        }
        case "GET crafting-history":
            return ok(res, grid.history);
        case "GET crafting-history/{id}": {
            const detail = grid.trackingDetails.get(Number(id));
            return detail ? ok(res, detail) : respond(res, "TRACKING_NOT_FOUND", null);
        }
        case "GET settings":
        case "PATCH settings": {
            if (method === "PATCH") {
                const body = await readJson(req);
                if (typeof body.isTracked === "boolean") grid.isTrackingEnabled = body.isTracked;
            }
            return ok(res, {
                isTracked: grid.isTrackingEnabled,
                trackedItems: grid.trackedItems,
                trackedItemNames: trackedItemNames(grid),
            });
        }
        case "GET item-history": {
            const rangeParam = params.get("range") ?? "7d";
            if (!STATS_RANGES.has(rangeParam as StatsRange)) return respond(res, "BAD_PARAM", null);
            const range = rangeParam as StatsRange;
            let customMinutes: number | undefined;
            if (range === "custom") {
                const minutesParam = params.get("minutes");
                const n = minutesParam === null ? NaN : Number(minutesParam);
                if (!Number.isInteger(n) || n < 1) return respond(res, "BAD_PARAM", null);
                customMinutes = Math.min(n, MOCK_HOURLY_RETENTION_DAYS * 1440);
            }
            const pointsParam = params.get("points");
            let points = DEFAULT_HISTORY_POINTS;
            if (pointsParam !== null) {
                const n = Number(pointsParam);
                if (!Number.isInteger(n) || n < 1) return respond(res, "BAD_PARAM", null);
                points = Math.min(n, MAX_HISTORY_POINTS);
            }
            const itemsParam = params.get("items");
            const itemids = itemsParam
                ? [
                      ...new Set(
                          itemsParam
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                      ),
                  ]
                : [...grid.trackedItems];
            return ok(res, mockItemHistory(grid, itemids, range, points, customMinutes));
        }
        case "GET tracked-items":
            return trackedItemsResponse(res, grid, grid.trackedItems);
        case "PUT tracked-items": {
            const body = await readJson(req);
            if (typeof body.items !== "string") return respond(res, "BAD_PARAM", null);
            const ids = body.items === "" ? [] : body.items.split(",").map((s) => s.trim());
            if (ids.some((tracked) => tracked.length > MAX_TRACKED_ITEMID_LENGTH)) {
                return respond(res, "BAD_PARAM", null);
            }
            return trackedItemsResponse(res, grid, [...new Set(ids.filter(Boolean))]);
        }
        case "PUT tracked-items/{id}": {
            const itemid = (id ?? "").trim();
            if (itemid.length === 0 || itemid.length > MAX_TRACKED_ITEMID_LENGTH) {
                return respond(res, "BAD_PARAM", null);
            }
            const next2 = grid.trackedItems.includes(itemid) ? grid.trackedItems : [...grid.trackedItems, itemid];
            return trackedItemsResponse(res, grid, next2);
        }
        case "DELETE tracked-items/{id}": {
            const itemid = (id ?? "").trim();
            // Untracking destroys that item's history (ItemHistoryStore.pruneTo) - the mock's stand-in is
            // dropping historyStart, so a re-track genuinely restarts the series.
            if (grid.trackedItems.includes(itemid)) grid.historyStart.delete(itemid);
            return trackedItemsResponse(
                res,
                grid,
                grid.trackedItems.filter((x) => x !== itemid),
            );
        }
        default:
            return respond(res, "NOT_FOUND", null);
    }
}

/** Applies a tracked-items change (or a read, for an unchanged list) the way `TrackedItems.respondWith` does. */
function trackedItemsResponse(res: ServerResponse, grid: MockGrid, next2: string[]): void {
    if (next2.length > MOCK_TRACKED_LIMIT) return respond(res, "TRACKED_LIMIT_REACHED", null);
    for (const itemid of next2) {
        if (!grid.historyStart.has(itemid)) grid.historyStart.set(itemid, Date.now());
    }
    grid.trackedItems = next2;
    ok(res, { tracked: grid.trackedItems, limit: MOCK_TRACKED_LIMIT, names: trackedItemNames(grid) });
}

/**
 * Fakes the Java HTTP API (the /api router - see `./gradlew generateApiDocs`) for `npm run dev`, so the UI
 * can be built without a running Minecraft server. Not wired into `npm run build`.
 */
export function mockApiPlugin(): Plugin {
    return {
        name: "ae2-mock-api",
        // http.WebHandler is the only thing that ever substitutes these tokens - `vite dev` serves
        // webpage.html/login.html raw, which would otherwise leave them as invalid JS in the browser.
        // `?publicmode=0` on either page's URL exercises the admin-only login variant without a restart.
        transformIndexHtml(html, ctx) {
            const params = new URL(ctx.originalUrl ?? "/", "http://localhost").searchParams;
            const isPublicMode = params.get("publicmode") !== "0";
            return html
                .replace("_REPLACE_ME_USERNAME", "DevAdmin")
                .replace("_REPLACE_ME_IS_ADMIN", "true")
                .replace("_REPLACE_ME_VERSION_OUTDATED", "false")
                .replace("_REPLACE_ME_IS_PUBLIC_MODE", isPublicMode ? "true" : "false")
                .replace("_REPLACE_ME_HAS_ITEM_ICONS", hasIcons() ? "true" : "false")
                .replace("_REPLACE_ME_HAS_GT", gtMode(ctx.originalUrl) === "0" ? "false" : "true");
        },
        configureServer(server) {
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                const params = url.searchParams;
                const method = req.method ?? "GET";

                if (method === "POST" && (url.pathname === "/" || url.pathname === "/login.html")) {
                    void handleLoginPost(req, res);
                    return;
                }

                if (url.pathname === "/icon") {
                    const itemid = params.get("id");
                    const file = itemid && hasIcons() ? join(ICON_DIR, iconFileName(itemid)) : undefined;
                    if (!file || !existsSync(file)) {
                        res.statusCode = 404;
                        res.end();
                        return;
                    }
                    res.setHeader("Content-Type", "image/png");
                    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
                    res.end(readFileSync(file));
                    return;
                }

                if (!url.pathname.startsWith("/api/")) {
                    next();
                    return;
                }
                const path = url.pathname.slice("/api/".length).split("/").map(decodeURIComponent);
                if (method !== "GET" && req.headers["x-ae2-request"] !== "true") {
                    // ApiRouter refuses a cookie-authenticated mutation without the marker header.
                    respond(res, "CSRF_REJECTED", null);
                    return;
                }
                void handleApi(method, path, params, req, res, next);
            });
        },
    };
}
