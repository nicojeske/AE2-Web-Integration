import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import {
    createJob,
    findGrid,
    findItemByHashcode,
    mockGrids,
    mockJobs,
    settleCompletedJobs,
    toCompactedItems,
    toCpuList,
    toGridSummaries,
    toJobData,
} from "./fixtures.ts";

function respond(res: ServerResponse, status: string, data: unknown): void {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ status, data }));
}

function ok(res: ServerResponse, data: unknown): void {
    respond(res, "OK", data);
}

/**
 * Fakes the Java HTTP API (see REDESIGN_MILESTONES.md's endpoint table) for `npm run dev`, so the UI
 * can be built without a running Minecraft server. Not wired into `npm run build`.
 */
export function mockApiPlugin(): Plugin {
    return {
        name: "ae2-mock-api",
        // AE2Controller.WebHandler is the only thing that ever substitutes these tokens - `vite dev` serves
        // webpage.html raw, which would otherwise leave them as invalid JS in the browser.
        transformIndexHtml(html) {
            return html
                .replace("_REPLACE_ME_USERNAME", "DevAdmin")
                .replace("_REPLACE_ME_IS_ADMIN", "true")
                .replace("_REPLACE_ME_VERSION_OUTDATED", "false")
                .replace("_REPLACE_ME_IS_PUBLIC_MODE", "true");
        },
        configureServer(server) {
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                const params = url.searchParams;
                const gridKey = params.has("grid") ? Number(params.get("grid")) : NaN;

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
                        ok(res, { isTracked: grid.isTrackingEnabled });
                        return;
                    }
                    default:
                        next();
                }
            });
        },
    };
}
