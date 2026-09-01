import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import { skipSpecialFormat } from "../api/format.ts";
import type { StatsRange } from "../api/types.ts";

import {
    createJob,
    findGrid,
    findItemByHashcode,
    MOCK_HOURLY_RETENTION_DAYS,
    MOCK_TRACKED_LIMIT,
    mockGrids,
    mockItemHistory,
    mockJobs,
    recordTracking,
    settleCompletedJobs,
    toCompactedItems,
    toCpuList,
    toGridSummaries,
    toJobData,
} from "./fixtures.ts";

const STATS_RANGES = new Set<StatsRange>(["15m", "1h", "6h", "24h", "7d", "30d", "1y", "all", "custom"]);
const MAX_HISTORY_POINTS = 500;
const DEFAULT_HISTORY_POINTS = 120;
const MAX_TRACKED_ITEMID_LENGTH = 256;

// Mirrors ItemIconIndex.java's matching rules (never committed to the repo - see .gitignore and
// CLAUDE.md - so this directory is expected to be missing for most contributors, which is fine: the
// feature just stays off, same as an unconfigured item_icon_directory server-side).
const ICON_DIR = fileURLToPath(new URL("../../../itempanel_icons", import.meta.url));

function normalizeIconName(raw: string): string {
    return skipSpecialFormat(raw)
        .replace(/[/\\:]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

let iconIndex: Map<string, string> | undefined;

/** Stands in for `CoreData`'s per-principal blob map - a single slot is fine since the mock server only
 *  ever serves one (dev) principal. */
let mockPrefsBlob: string | null = null;

/** Lazily scanned once per dev-server run - the directory doesn't change without a restart either. */
function loadIconIndex(): Map<string, string> {
    if (!iconIndex) {
        iconIndex = new Map();
        if (existsSync(ICON_DIR)) {
            for (const file of readdirSync(ICON_DIR)) {
                if (!file.toLowerCase().endsWith(".png")) continue;
                const key = normalizeIconName(file.slice(0, -4));
                if (!iconIndex.has(key)) iconIndex.set(key, file);
            }
        }
    }
    return iconIndex;
}

function respond(res: ServerResponse, status: string, data: unknown): void {
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

/**
 * Mocks AE2Controller.checkAuth's native-form-POST-to-"/" login/register flow (302 redirects, no
 * {status,data} envelope - see REDESIGN_MILESTONES.md M9 notes on why login.html isn't a fetch()
 * client). Password rules are dev-only conveniences, not a real auth check: password "password" always
 * succeeds, username "baduser" is "unknown", register username "offline" is "not online".
 */
async function handleLoginPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = new URLSearchParams(await readBody(req));
    const redirect = (location: string) => {
        res.statusCode = 302;
        res.setHeader("Location", location);
        res.end();
    };

    if (body.has("register") && body.has("password")) {
        const username = body.get("register") ?? "";
        if (username.trim().toLowerCase() === "offline") {
            redirect("?notonline");
            return;
        }
        redirect(`?confirmregistration&token=${"mockconfirmationtoken1234567890"}`);
        return;
    }

    if (body.has("username") && body.has("password")) {
        const username = body.get("username") ?? "";
        const password = body.get("password") ?? "";
        if (username.trim().toLowerCase() === "baduser") {
            redirect("?invaliduser");
            return;
        }
        if (password !== "password" && username.trim().toLowerCase() !== "admin") {
            redirect("?invalidpassword");
            return;
        }
        res.setHeader("Set-Cookie", "authenticationToken=mock-dev-token; Path=/; HttpOnly");
        redirect(".");
        return;
    }

    res.statusCode = 400;
    res.end();
}

/**
 * Fakes the Java HTTP API (see REDESIGN_MILESTONES.md's endpoint table) for `npm run dev`, so the UI
 * can be built without a running Minecraft server. Not wired into `npm run build`.
 */
export function mockApiPlugin(): Plugin {
    return {
        name: "ae2-mock-api",
        // AE2Controller.WebHandler is the only thing that ever substitutes these tokens - `vite dev` serves
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
                .replace("_REPLACE_ME_HAS_ITEM_ICONS", loadIconIndex().size > 0 ? "true" : "false");
        },
        configureServer(server) {
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                const params = url.searchParams;
                const gridKey = params.has("grid") ? Number(params.get("grid")) : NaN;

                if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/login.html")) {
                    void handleLoginPost(req, res);
                    return;
                }

                for (const grid of mockGrids) settleCompletedJobs(grid);

                switch (url.pathname) {
                    case "/grids": {
                        ok(res, toGridSummaries());
                        return;
                    }
                    case "/items": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        ok(res, grid.items);
                        return;
                    }
                    case "/list": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        ok(res, toCpuList(grid));
                        return;
                    }
                    case "/get": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        const cpuName = params.get("cpu");
                        const busy = grid.busyCpus.find((c) => c.name === cpuName);
                        if (busy) {
                            const items = toCompactedItems(busy);
                            // GetCPUList.java/GetCPU.java only set timeStarted/timeElapsed inside their
                            // hasTrackingInfo branch - an untracked busy CPU reports neither.
                            ok(res, {
                                size: busy.availableStorage,
                                isBusy: true,
                                finalOutput: busy.output,
                                items,
                                hasTrackingInfo: busy.hasTrackingInfo,
                                timeStarted: busy.hasTrackingInfo ? busy.startedAt : 0,
                                timeElapsed: busy.hasTrackingInfo ? Date.now() - busy.startedAt : 0,
                            });
                            return;
                        }
                        const idle = grid.idleCpus.find((c) => c.name === cpuName);
                        if (idle) {
                            // GetCPU.java skips its whole busy block for an idle CPU, so `items` comes
                            // back `null` (GSON_BUILDER serializes nulls) - not `[]`.
                            ok(res, {
                                size: idle.availableStorage,
                                isBusy: false,
                                finalOutput: null,
                                items: null,
                                hasTrackingInfo: false,
                                timeStarted: 0,
                                timeElapsed: 0,
                            });
                            return;
                        }
                        respond(res, "CPU_NOT_FOUND", null);
                        return;
                    }
                    case "/cancelcpu": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        const cpuName = params.get("cpu");
                        const idx = grid.busyCpus.findIndex((c) => c.name === cpuName);
                        if (idx === -1) return respond(res, "CPU_NOT_BUSY", null);
                        const cancelled = grid.busyCpus.splice(idx, 1)[0]!;
                        recordTracking(grid, cancelled, true);
                        grid.idleCpus.push({
                            name: cancelled.name,
                            coProcessors: cancelled.coProcessors,
                            availableStorage: cancelled.availableStorage,
                        });
                        ok(res, null);
                        return;
                    }
                    case "/order": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        const hashcode = Number(params.get("item"));
                        const quantity = Number(params.get("quantity"));
                        const found = findItemByHashcode(hashcode);
                        if (!found || !found.item.craftable) return respond(res, "ITEM_NOT_FOUND", null);
                        if (grid.idleCpus.length === 0) return respond(res, "ALL_CPU_BUSY", null);
                        const job = createJob(gridKey, hashcode, quantity);
                        ok(res, { jobID: job.id });
                        return;
                    }
                    case "/job": {
                        const jobId = Number(params.get("id"));
                        const job = mockJobs.get(jobId);
                        if (!job) return respond(res, "INVALID_ID", null);
                        if (params.has("cancel")) {
                            mockJobs.delete(jobId);
                            ok(res, null);
                            return;
                        }
                        if (params.has("submit")) {
                            const data = toJobData(job);
                            if (!data.isDone) return respond(res, "JOB_NOT_DONE", null);
                            const grid = findGrid(job.gridKey);
                            if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                            const cpuName = params.get("cpu");
                            const idleIdx = grid.idleCpus.findIndex((c) => c.name === cpuName);
                            const busyCpu = grid.busyCpus.find((c) => c.name === cpuName);
                            if (idleIdx === -1 && !busyCpu) return respond(res, "CPU_NOT_FOUND", null);
                            const itemMatch = findItemByHashcode(job.itemHashcode);
                            const outputItemid = itemMatch?.item.itemid ?? "unknown";

                            if (busyCpu) {
                                // Merge into an already-busy CPU crafting the same output - the real
                                // AE2CraftingGrid.submitJob would refuse a genuine output mismatch even if
                                // a stale client somehow posted one (the UI's own row validation is what
                                // normally prevents this from ever being reachable by clicking).
                                if (busyCpu.output.itemid !== outputItemid) {
                                    return respond(res, "FAIL", "Target CPU is crafting a different item");
                                }
                                busyCpu.usedStorage =
                                    (busyCpu.usedStorage === -1 ? 0 : busyCpu.usedStorage) +
                                    Math.round(data.bytesTotal);
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
                                        hashcode: job.itemHashcode,
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
                            ok(res, null);
                            return;
                        }
                        ok(res, toJobData(job));
                        return;
                    }
                    case "/trackinghistory": {
                        const grid = findGrid(gridKey);
                        ok(res, grid?.history ?? []);
                        return;
                    }
                    case "/gettracking": {
                        const grid = findGrid(gridKey);
                        const id = Number(params.get("id"));
                        const detail = grid?.trackingDetails.get(id);
                        if (!detail) return respond(res, "TRACKING_NOT_FOUND", null);
                        ok(res, detail);
                        return;
                    }
                    case "/gridsettings": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        if (params.has("track")) {
                            grid.isTrackingEnabled = params.get("track") === "1";
                        }
                        ok(res, { isTracked: grid.isTrackingEnabled, trackedItems: grid.trackedItems });
                        return;
                    }
                    case "/itemhistory": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
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
                        ok(res, mockItemHistory(grid, itemids, range, points, customMinutes));
                        return;
                    }
                    case "/trackeditems": {
                        const grid = findGrid(gridKey);
                        if (!grid) return respond(res, "GRID_NOT_FOUND", null);
                        let next2 = grid.trackedItems;
                        if (params.has("set")) {
                            const raw = params.get("set") ?? "";
                            const ids = raw === "" ? [] : raw.split(",").map((s) => s.trim());
                            if (ids.some((id) => id.length > MAX_TRACKED_ITEMID_LENGTH)) {
                                return respond(res, "BAD_PARAM", null);
                            }
                            next2 = [...new Set(ids.filter(Boolean))];
                        }
                        if (params.has("add")) {
                            const id = (params.get("add") ?? "").trim();
                            if (id.length === 0 || id.length > MAX_TRACKED_ITEMID_LENGTH) {
                                return respond(res, "BAD_PARAM", null);
                            }
                            if (!next2.includes(id)) next2 = [...next2, id];
                        }
                        if (params.has("remove")) {
                            const id = (params.get("remove") ?? "").trim();
                            if (next2.includes(id)) {
                                // Untracking destroys that item's history (ItemHistoryStore.pruneTo) - the
                                // mock's stand-in is dropping historyStart, so a re-track genuinely restarts
                                // the series instead of picking up where it left off.
                                grid.historyStart.delete(id);
                            }
                            next2 = next2.filter((x) => x !== id);
                        }
                        if (next2.length > MOCK_TRACKED_LIMIT) return respond(res, "TRACKED_LIMIT_REACHED", null);
                        for (const id of next2) {
                            if (!grid.historyStart.has(id)) grid.historyStart.set(id, Date.now());
                        }
                        grid.trackedItems = next2;
                        ok(res, { tracked: grid.trackedItems, limit: MOCK_TRACKED_LIMIT });
                        return;
                    }
                    case "/prefs": {
                        // Mirrors PlayerPrefsHandler.java: a non-empty body writes, presence-of-body
                        // (not HTTP method) decides read vs write either way.
                        void (async () => {
                            const body = await readBody(req);
                            if (body.length > 0) mockPrefsBlob = body;
                            ok(res, { blob: mockPrefsBlob });
                        })();
                        return;
                    }
                    case "/icon": {
                        const name = params.get("name");
                        const file = name ? loadIconIndex().get(normalizeIconName(name)) : undefined;
                        if (!file) {
                            res.statusCode = 404;
                            res.end();
                            return;
                        }
                        res.setHeader("Content-Type", "image/png");
                        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
                        res.end(readFileSync(join(ICON_DIR, file)));
                        return;
                    }
                    default:
                        next();
                }
            });
        },
    };
}
