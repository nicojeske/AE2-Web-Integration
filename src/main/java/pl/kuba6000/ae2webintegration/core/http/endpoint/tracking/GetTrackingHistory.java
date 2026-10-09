package pl.kuba6000.ae2webintegration.core.http.endpoint.tracking;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.api.JSON_Stack;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;
import pl.kuba6000.ae2webintegration.core.tracking.AE2JobTracker;

/**
 * Lists finished crafting jobs, newest first. With a history database they are kept across restarts for
 * {@code tracking.history_retention_days}; without one, only the jobs since the last restart are listed.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path or query value, unexpected body, or invalid
 *           JSON/input fields, or a limit outside 1-500.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} NO_PERMISSIONS: the user cannot access this grid.
 * @response 404 {@link ErrorResponse} GRID_NOT_FOUND: the grid does not exist.
 * @response 405 {@link ErrorResponse} METHOD_NOT_ALLOWED: this path does not support the method; Allow lists
 *           supported methods.
 * @response 413 {@link ErrorResponse} REQUEST_TOO_LARGE: the request body exceeds 8192 bytes.
 * @response 429 {@link ErrorResponse} TOO_MANY_REQUESTS: the unauthenticated request rate limit was exceeded.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed because of an unexpected
 *           failure.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"NO_PERMISSIONS","data":null}
 * @responseExample 404 {"status":"GRID_NOT_FOUND","data":null}
 * @responseExample 405 {"status":"METHOD_NOT_ALLOWED","data":null}
 * @responseExample 413 {"status":"REQUEST_TOO_LARGE","data":null}
 * @responseExample 429 {"status":"TOO_MANY_REQUESTS","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/grids/{gridKey}/crafting-history")
public final class GetTrackingHistory extends IAsyncRequest {

    /**
     * Successful operation result.
     * 
     * @param status {@code OK} for a successful request
     * @param data   history entries ordered by completion time, newest first; empty when no history has been recorded
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull List<HistoryEntry> data) {}

    @SuppressWarnings("unused") // Gson reads the fields reflectively.
    public static class HistoryEntry {

        /**
         * Crafting start time in Unix epoch milliseconds.
         *
         * @example 1700000000000
         */
        public long timeStarted;
        /**
         * Completion time in Unix epoch milliseconds.
         *
         * @example 1700000010000
         */
        public long timeDone;
        /**
         * Whether the crafting work was cancelled.
         *
         * @example false
         */
        public boolean wasCancelled;
        /** Detached snapshot of the final crafting output. */
        public final @NotNull JSON_Stack finalOutput;
        /**
         * History entry identifier, used to read the entry's detail.
         *
         * @example 12
         */
        public long id;
        /** Player or web user who submitted the job; null for a machine or when unknown. */
        public @Nullable String requestedBy;

        private HistoryEntry(@NotNull JSON_Stack finalOutput) {
            this.finalOutput = finalOutput;
        }
    }

    private static final int MAX_LIMIT = 500;

    /** Only jobs finished before this Unix epoch millisecond time - the oldest one of the previous page. */
    @QueryParam("before")
    @OptionalInput
    private long before = Long.MAX_VALUE;

    /** Most entries to return (1-500). */
    @QueryParam("limit")
    @OptionalInput
    private int limit = 100;

    /** Only jobs whose final output is this registry resource identifier. */
    @QueryParam("itemid")
    @OptionalInput
    private @Nullable String itemid;

    @Override
    public void handle() {
        if (limit < 1 || limit > MAX_LIMIT) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        HistoryDb db = HistoryDb.get();
        List<HistoryEntry> jobs = db != null ? fromDatabase(db) : fromMemory();
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, jobs));
    }

    private List<HistoryEntry> fromDatabase(HistoryDb db) {
        List<HistoryEntry> jobs = new ArrayList<>();
        for (HistoryDb.CraftJob job : db.readCraftJobs(gridKey.toString(), itemid, before, limit)) {
            HistoryEntry entry = new HistoryEntry(
                JSON_Stack.stored(job.outputItemid, job.outputName, job.quantity, job.outputItemKey));
            entry.id = job.id;
            entry.timeStarted = job.started;
            entry.timeDone = job.done;
            entry.wasCancelled = job.cancelled;
            entry.requestedBy = job.requestedBy;
            jobs.add(entry);
        }
        return jobs;
    }

    /** No database: what this run tracked, filtered and paged the same way. */
    private List<HistoryEntry> fromMemory() {
        List<HistoryEntry> jobs = new ArrayList<>();
        if (grid == null) return jobs; // nothing has ever been tracked on this grid
        for (Map.Entry<Integer, AE2JobTracker.JobTrackingInfo> tracked : grid.trackingInfo.trackingInfos.entrySet()) {
            AE2JobTracker.JobTrackingInfo info = tracked.getValue();
            if (info.timeDone >= before || (itemid != null && !itemid.equals(info.finalOutput.itemid))) continue;
            HistoryEntry entry = new HistoryEntry(info.finalOutput);
            entry.id = tracked.getKey();
            entry.timeStarted = info.timeStarted;
            entry.timeDone = info.timeDone;
            entry.wasCancelled = info.wasCancelled;
            entry.requestedBy = info.requestedBy;
            jobs.add(entry);
        }
        jobs.sort((i1, i2) -> Long.compare(i2.timeDone, i1.timeDone));
        return jobs.size() > limit ? new ArrayList<>(jobs.subList(0, limit)) : jobs;
    }

}
