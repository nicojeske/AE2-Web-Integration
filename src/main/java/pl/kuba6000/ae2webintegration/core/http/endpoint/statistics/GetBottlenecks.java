package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.net.HttpURLConnection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.analysis.BottleneckAnalysis;
import pl.kuba6000.ae2webintegration.core.api.JSON_Bottlenecks;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTStateLog;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * Ranks the machines crafting jobs waited on over a range, from the recorded crafting history: how long work
 * queued behind each one, how long each was a job's only open step, and which job outputs starved for
 * ingredients. Cancel-closed and outlier intervals are excluded or clipped, see {@code BottleneckAnalysis}.
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
@Endpoint(method = HttpMethod.GET, path = "/api/grids/{gridKey}/bottlenecks")
public final class GetBottlenecks extends IAsyncRequest {

    private static final long CACHE_MILLIS = TimeUnit.MINUTES.toMillis(1);
    private static final int CACHE_SIZE = 32;

    @Desugar
    private record Cached(long createdMillis, JSON_Bottlenecks data) {}

    /** Keyed by grid and minute-aligned range, so a page polling within the minute reuses the analysis. */
    private static final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   machine and job output rankings over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_Bottlenecks data) {}

    /**
     * Time range ending now: 24h, 7d, 30d, 90d, 1y, all (the crafting history retention) or custom.
     */
    @QueryParam("range")
    @OptionalInput
    private String range = "7d";

    /** Length of a {@code custom} range in minutes, capped at the crafting history retention. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    /** Analyse the range of the same length just before, for comparing against it. */
    @QueryParam("previous")
    @OptionalInput
    private boolean previous;

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
        Long span = spanMillis(range, minutes);
        if (span == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        long minute = TimeUnit.MINUTES.toMillis(1);
        long to = Math.floorDiv(System.currentTimeMillis(), minute) * minute;
        if (previous) to -= span;
        long from = to - span;

        long now = System.currentTimeMillis();
        String cacheKey = gridKey + "|" + from + "|" + to;
        Cached cached = cache.get(cacheKey);
        if (cached == null || now - cached.createdMillis() > CACHE_MILLIS) {
            BottleneckAnalysis analysis = new BottleneckAnalysis(from, to, bucketMillis(span));
            if (!db.readCraftIntervals(gridKey.toString(), from, to, analysis)) {
                deny(ApiStatus.INTERNAL_ERROR);
                return;
            }
            boolean powerData = GTEngine.isAvailable();
            JSON_Bottlenecks data = analysis
                .result(powerData ? GTStateLog.outages(from, to) : BottleneckAnalysis.OutageCheck.NONE);
            data.powerData = powerData;
            if (cache.size() >= CACHE_SIZE) cache.clear();
            cached = new Cached(now, data);
            cache.put(cacheKey, cached);
        }
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, cached.data()));
    }

    static @Nullable Long spanMillis(String range, @Nullable Integer minutes) {
        long max = TimeUnit.DAYS.toMillis(Config.INSTANCE.tracking.historyRetentionDays);
        long millis;
        switch (range) {
            case "24h":
                millis = TimeUnit.HOURS.toMillis(24);
                break;
            case "7d":
                millis = TimeUnit.DAYS.toMillis(7);
                break;
            case "30d":
                millis = TimeUnit.DAYS.toMillis(30);
                break;
            case "90d":
                millis = TimeUnit.DAYS.toMillis(90);
                break;
            case "1y":
                millis = TimeUnit.DAYS.toMillis(365);
                break;
            case "all":
                millis = max;
                break;
            case "custom":
                if (minutes == null || minutes < 1) return null;
                millis = TimeUnit.MINUTES.toMillis(minutes);
                break;
            default:
                return null;
        }
        return Math.min(millis, max);
    }

    /** Trend resolution: hours up to two days, days up to two months, weeks beyond. */
    static long bucketMillis(long spanMillis) {
        if (spanMillis <= TimeUnit.DAYS.toMillis(2)) return TimeUnit.HOURS.toMillis(1);
        if (spanMillis <= TimeUnit.DAYS.toMillis(62)) return TimeUnit.DAYS.toMillis(1);
        return TimeUnit.DAYS.toMillis(7);
    }
}
