package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.net.HttpURLConnection;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;
import pl.kuba6000.ae2webintegration.core.server.ServerLoad;

/**
 * Reads the server's tick rate over a range: ticks per second, milliseconds per tick and the longest tick, per
 * window. Lag slows crafting and GregTech machines alike, so it is the context for every duration elsewhere.
 * Values of -1 mark windows without a sample (the server was offline).
 *
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed query parameter, or {@code from} not before {@code to}.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} HISTORY_DISABLED: no history database is configured.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"HISTORY_DISABLED","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/server/tick-rate")
public final class GetServerTickRate extends IAsyncRequest {

    private static final int MAX_POINTS = 1000;

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   tick rate per window over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull ServerLoad.Series data) {}

    /** Range start in Unix epoch milliseconds; defaults to 24 hours before {@code to}. */
    @QueryParam("from")
    @OptionalInput
    private long from = -1;

    /** Range end in Unix epoch milliseconds; defaults to now. */
    @QueryParam("to")
    @OptionalInput
    private long to = -1;

    /** Most windows in the series (1-1000). */
    @QueryParam("points")
    @OptionalInput
    private int points = 300;

    @Override
    public void handle() {
        long end = to < 0 ? System.currentTimeMillis() : to;
        long start = from < 0 ? end - TimeUnit.DAYS.toMillis(1) : from;
        if (start >= end || points < 1 || points > MAX_POINTS) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            deny(ApiStatus.HISTORY_DISABLED);
            return;
        }
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, ServerLoad.read(db, start, end, points)));
    }
}
