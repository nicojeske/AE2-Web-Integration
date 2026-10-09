package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.gt.GTProductionLog;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * Reads the amount produced per window, summed over the visible machines.
 *
 * Without {@code item} it sums every stack, which is only meaningful together with {@code machine}.
 * 
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or query parameter.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 *           HISTORY_DISABLED when no history database is configured.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/production/history")
public final class GetGTProductionHistory extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   amount produced per bucket over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull GTProductionLog.Series data) {}

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 90d, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "7d";

    /** Length of a {@code custom} range in minutes. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    /** Most buckets in the series (1-500). */
    @QueryParam("points")
    @OptionalInput
    private int points = DEFAULT_POINTS;

    /** Item or fluid id to count; every stack when omitted. */
    @QueryParam("item")
    @OptionalInput
    private @Nullable String item;

    /** {@code produced} (recipe outputs) or {@code consumed} (recipe inputs). */
    @QueryParam("flow")
    @OptionalInput
    private String flow = "produced";

    /** Machine id to restrict the series to. */
    @QueryParam("machine")
    @OptionalInput
    private @Nullable String machine;

    @Override
    protected void handleGT(WebPrincipal principal) {
        Long span = parseRange(range, minutes, GetGTProduction.maxRangeMillis());
        Integer points = parsePoints(this.points);
        GTFlow flow = GTFlow.fromParam(this.flow);
        if (span == null || points == null || flow == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        if (HistoryDb.get() == null) {
            deny(ApiStatus.HISTORY_DISABLED);
            return;
        }
        long now = System.currentTimeMillis();
        respond(
            HttpURLConnection.HTTP_OK,
            new Response(
                ApiStatus.OK,
                GTProductionLog.series(
                    flow,
                    emptyToNull(item),
                    emptyToNull(machine),
                    now - span,
                    now,
                    now,
                    points,
                    visibleTo(principal))));
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }
}
