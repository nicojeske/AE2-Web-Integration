// The order -> plan chain shared by the interactive order flow (order.tsx) and the headless auto-craft
// driver (autoCraft.tsx, M6). Extracted from order.tsx's original calculate() so both callers run the
// exact same sequence against the real API: re-fetch items for a live hashcode (caveat 3) -> order() ->
// poll job?id= until isDone. No Preact here - a leaf module, like orderModel.ts/craftDetailModel.ts.
import { cancelJob, getItems, getJob, order as orderRequest } from "../api/client";
import type { JobData } from "../api/types";

/** Thrown when the target item is no longer present in a fresh `items?grid=` fetch. */
export class ItemGoneError extends Error {
    constructor() {
        super("That item is no longer on this network");
        this.name = "ItemGoneError";
    }
}

/** Thrown when `job?id=` never reaches `isDone` within `timeoutMs`. The job is cancelled before throwing. */
export class PlanTimeoutError extends Error {
    constructor() {
        super("The plan took too long to compute");
        this.name = "PlanTimeoutError";
    }
}

export interface PlanHandle {
    jobId: number;
    job: JobData;
}

export interface ComputePlanRequest {
    gridId: number;
    itemid: string;
    quantity: number;
}

export interface ComputePlanHooks {
    /** Checked before/after every await; a `true` return aborts the chain (caller supersedes it). */
    isStale: () => boolean;
    /** Fired once `order()` returns a jobId, before polling starts - lets the caller store it for cleanup. */
    onJobId?: (jobId: number) => void;
    /** Default ~120s - `Job` is a synced request; a plan that never finishes must not poll forever. */
    timeoutMs?: number;
}

/** Poll `job?id=` every 1s for the first 15s (typical small plans), then back off to 2.5s - `Job` is a
 *  synced request on the server thread, so a large plan shouldn't be hammered while it computes. */
export const FAST_POLL_MS = 1000;
export const SLOW_POLL_MS = 2500;
export const FAST_POLL_WINDOW_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs order -> poll job?id= to completion. Returns `null` when `isStale()` goes true mid-flight (the
 * caller superseded this chain - not an error). Throws `ItemGoneError` when the item vanished from a
 * fresh `items` fetch, `PlanTimeoutError` when the poll loop exceeds `timeoutMs` (the job is cancelled
 * first), or an `ApiError`/`Error` from the underlying requests.
 */
export async function computePlan(req: ComputePlanRequest, hooks: ComputePlanHooks): Promise<PlanHandle | null> {
    const { gridId, itemid, quantity } = req;
    const { isStale, onJobId, timeoutMs = DEFAULT_TIMEOUT_MS } = hooks;

    // A direct single-grid fetch, not a shared items store's refresh(): GetItems.java clears the one
    // global hashcodeToStack map on every call, so only a fresh call against *this* grid guarantees a
    // live hashcode for the order that follows (REDESIGN_MILESTONES.md caveat 3).
    const rows = await getItems(gridId);
    if (isStale()) return null;
    const row = rows.find((r) => r.itemid === itemid);
    if (!row) throw new ItemGoneError();

    const { jobID } = await orderRequest(gridId, row.hashcode, quantity);
    if (isStale()) {
        // Best-effort: an already-finished/expired job answers INVALID_ID, nothing to clean up.
        void cancelJob(gridId, jobID).catch(() => {});
        return null;
    }
    onJobId?.(jobID);

    const startedPolling = Date.now();
    for (;;) {
        if (isStale()) return null;
        const elapsed = Date.now() - startedPolling;
        if (elapsed >= timeoutMs) {
            void cancelJob(gridId, jobID).catch(() => {});
            throw new PlanTimeoutError();
        }
        const job = await getJob(gridId, jobID);
        if (isStale()) return null;
        if (job.isDone) return { jobId: jobID, job };
        await sleep(elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
    }
}
