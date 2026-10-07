package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.api.JSON_ItemHistory;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;

/**
 * Reads sampled stored-count history of tracked items.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value, query parameter or body.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 403 {@link ErrorResponse} NO_PERMISSIONS: the user cannot access this grid.
 * @response 404 {@link ErrorResponse} GRID_NOT_FOUND: the grid does not exist.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"NO_PERMISSIONS","data":null}
 * @responseExample 404 {"status":"GRID_NOT_FOUND","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/grids/{gridKey}/item-history")
public final class GetItemHistory extends IAsyncRequest {

    private static final int DEFAULT_POINTS = 120;
    private static final int MAX_POINTS = 500;

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   one series per requested item, bucketed over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_ItemHistory data) {}

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
    private int points = DEFAULT_POINTS;

    /** Comma-separated item ids; all tracked items when omitted or empty. */
    @QueryParam("items")
    @OptionalInput
    private @Nullable String items;

    @Override
    public void handle() {
        if (gridKey == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }
        GridPersistentData data = CoreEngine.GRID_IDENTITIES.getPersistentData(gridKey);
        if (data == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }

        Long spanMillis;
        if (range.equals("custom")) {
            if (minutes == null || minutes < 1) {
                deny(ApiStatus.BAD_PARAM);
                return;
            }
            long maxMinutes = TimeUnit.DAYS.toMinutes(Config.INSTANCE.statistics.hourlyRetentionDays);
            spanMillis = TimeUnit.MINUTES.toMillis(Math.min(minutes, maxMinutes));
        } else {
            spanMillis = rangeToMillis(range);
        }
        if (spanMillis == null || points < 1) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }

        List<String> itemids = resolveItemIds(
            items,
            data.getSettings()
                .getTrackedItems());
        long now = System.currentTimeMillis();
        respond(
            HttpURLConnection.HTTP_OK,
            new Response(
                ApiStatus.OK,
                ItemHistoryStore
                    .readSeries(gridKey.toString(), itemids, now - spanMillis, now, Math.min(points, MAX_POINTS))));
    }

    private static List<String> resolveItemIds(@Nullable String csv, Set<String> tracked) {
        if (csv == null || csv.isEmpty()) {
            return new ArrayList<>(tracked);
        }
        Set<String> requested = new LinkedHashSet<>();
        for (String raw : csv.split(",")) {
            String itemid = raw.trim();
            if (!itemid.isEmpty()) {
                requested.add(itemid);
            }
        }
        return new ArrayList<>(requested);
    }

    /** "all" is honestly labelled: it maps to the full configured retention, not an unbounded range. */
    private static @Nullable Long rangeToMillis(String range) {
        switch (range) {
            case "15m":
                return TimeUnit.MINUTES.toMillis(15);
            case "1h":
                return TimeUnit.HOURS.toMillis(1);
            case "6h":
                return TimeUnit.HOURS.toMillis(6);
            case "24h":
                return TimeUnit.HOURS.toMillis(24);
            case "7d":
                return TimeUnit.DAYS.toMillis(7);
            case "30d":
                return TimeUnit.DAYS.toMillis(30);
            case "1y":
                return TimeUnit.DAYS.toMillis(365);
            case "all":
                return TimeUnit.DAYS.toMillis(Config.INSTANCE.statistics.hourlyRetentionDays);
            default:
                return null;
        }
    }
}
