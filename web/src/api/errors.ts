import { ApiError } from "./client";

/**
 * Readable copy for the server's error codes, used anywhere an order/job/craft action can fail -
 * since a denial (`FAIL` from AE2 itself, a vanished item) needs more than a raw status code in a toast.
 */
export function describeApiError(e: unknown, fallback: string): string {
    if (!(e instanceof ApiError)) {
        return e instanceof Error ? e.message : fallback;
    }
    switch (e.status) {
        case "FAIL":
            // web$submitJob's own message (SubmitCraftingPlan.java) - the only status where the payload is
            // meant to be shown to the user rather than just logged.
            return `AE2 refused the job: ${typeof e.payload === "string" ? e.payload : "unknown reason"}`;
        case "ITEM_NOT_FOUND":
        case "ITEM_IDENTITY_UNKNOWN":
            return "That item is no longer on this network";
        case "AMBIGUOUS_ITEM_KEY":
            return "AE2 can't tell this item apart from another one - it can't be ordered from here";
        case "INVALID_QUANTITY":
            return "Enter a whole number greater than zero";
        case "CPU_NOT_FOUND":
            return "That crafting CPU is no longer available";
        case "CPU_NOT_BUSY":
            return "That job already finished";
        case "INVALID_ID":
            return "This plan expired - start the order again";
        case "JOB_NOT_DONE":
            return "The plan isn't ready yet - try again in a moment";
        case "GRID_NOT_FOUND":
            return "This network is no longer available";
        case "NO_PERMISSIONS":
            return "You no longer have access to this network";
        case "HISTORY_DISABLED":
            return "History isn't recorded on this server - it needs a history database";
        case "BAD_PARAM":
            return "The server rejected that request - try reloading the page";
        case "TRACKING_NOT_FOUND":
            return "This job's tracking data is gone - the server may have restarted since it finished";
        case "CSRF_REJECTED":
            return "The server rejected that request as unsafe - reload the page and try again";
        case "TOO_MANY_REQUESTS":
            return "Too many requests - wait a moment and try again";
        case "SERVER_BUSY":
            return "The server is busy right now - try again in a moment";
        case "TIMEOUT":
            return "The server didn't respond in time - try again";
        case "SERVER_STOPPING":
            return "The server is shutting down";
        default:
            return fallback;
    }
}
