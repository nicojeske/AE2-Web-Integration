import { ApiError } from "./client";

/**
 * Readable copy for the server's error codes, used anywhere an order/job/craft action can fail -
 * introduced in M4 since this is the first milestone where a denial is common enough (`ALL_CPU_BUSY`,
 * `FAIL` from AE2 itself) to need more than a raw status code in a toast.
 */
export function describeApiError(e: unknown, fallback: string): string {
    if (!(e instanceof ApiError)) {
        return e instanceof Error ? e.message : fallback;
    }
    switch (e.status) {
        case "ALL_CPU_BUSY":
            return "Every crafting CPU is busy - cancel a job or wait for one to finish";
        case "FAIL":
            // web$submitJob's own message (Job.java:149) - the only status where the payload is meant
            // to be shown to the user rather than just logged.
            return `AE2 refused the job: ${typeof e.payload === "string" ? e.payload : "unknown reason"}`;
        case "ITEM_NOT_FOUND":
            return "That item is no longer on this network";
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
