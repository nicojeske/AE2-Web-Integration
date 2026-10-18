package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.net.HttpURLConnection;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;
import pl.kuba6000.ae2webintegration.core.tracking.GridStatsStore;

/**
 * Reads a grid's storage capacity (item and fluid bytes and types) and AE power over a range, sampled with the item
 * statistics, plus when bytes and types run out at the range's trend.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or query parameter.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 403 {@link ErrorResponse} NO_PERMISSIONS: the user cannot access this grid.
 * @response 404 {@link ErrorResponse} GRID_NOT_FOUND: the grid does not exist. HISTORY_DISABLED: no history
 *           database is configured.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"NO_PERMISSIONS","data":null}
 * @responseExample 404 {"status":"GRID_NOT_FOUND","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/grids/{gridKey}/capacity")
public final class GetGridCapacity extends IAsyncRequest {

    private static final int MAX_POINTS = 500;

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   current capacity and power, their history over the range and the projected run-out times
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull GridStatsStore.Capacity data) {}

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 1y, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "7d";

    /** Length of a {@code custom} range in minutes, capped at the configured retention. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    /** Most buckets per series (1-500). */
    @QueryParam("points")
    @OptionalInput
    private int points = 120;

    @Override
    public void handle() {
        if (gridKey == null || CoreEngine.GRID_IDENTITIES.getPersistentData(gridKey) == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            deny(ApiStatus.HISTORY_DISABLED);
            return;
        }
        Long span;
        if (range.equals("custom")) {
            long maxMinutes = TimeUnit.DAYS.toMinutes(Config.INSTANCE.statistics.hourlyRetentionDays);
            span = minutes == null || minutes < 1 ? null : TimeUnit.MINUTES.toMillis(Math.min(minutes, maxMinutes));
        } else {
            span = GetItemHistory.rangeToMillis(range);
        }
        if (span == null || points < 1 || points > MAX_POINTS) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        long now = System.currentTimeMillis();
        respond(
            HttpURLConnection.HTTP_OK,
            new Response(ApiStatus.OK, GridStatsStore.read(db, gridKey.toString(), now - span, now, points)));
    }
}
