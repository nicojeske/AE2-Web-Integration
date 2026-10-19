package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTTunnelStore;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * Reads the throughput history of one EU P2P tunnel: average EU/t, the busiest scan's EU/t and the per-mille of
 * ticks the line was maxed out, per bucket.
 *
 * Values are longs saturated at {@link Long#MAX_VALUE}; -1 = no sample. Only tunnels currently known are served, since
 * visibility needs the owner.
 * 
 * @pathParam tunnelId Tunnel id, as listed by the tunnels endpoint.
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or query parameter.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled. NOT_FOUND
 *           when the tunnel does not exist or is not visible.
 *           HISTORY_DISABLED when no history database is configured.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/tunnels/{tunnelId}/history")
public final class GetGTTunnelHistory extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   throughput per bucket over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull GTTunnelStore.Series data) {}

    @PathParam("tunnelId")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String tunnelId;

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 90d, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "24h";

    /** Length of a {@code custom} range in minutes. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    /** Most buckets in the series (1-500). */
    @QueryParam("points")
    @OptionalInput
    private int points = DEFAULT_POINTS;

    @Override
    protected void handleGT(WebPrincipal principal) {
        Long span = parseRange(
            range,
            minutes,
            TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.powerHourlyRetentionDays));
        Integer points = parsePoints(this.points);
        if (span == null || points == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        GTTunnelStore.View tunnel = GTTunnelStore.latest(tunnelId);
        if (tunnel == null || !GTVisibility.canSee(principal, tunnel.snapshot.owner)) {
            deny(ApiStatus.NOT_FOUND);
            return;
        }
        HistoryDb db = HistoryDb.get();
        if (db == null) {
            deny(ApiStatus.HISTORY_DISABLED);
            return;
        }
        long now = System.currentTimeMillis();
        respond(
            HttpURLConnection.HTTP_OK,
            new Response(ApiStatus.OK, GTTunnelStore.read(db, tunnelId, now - span, now, points)));
    }
}
