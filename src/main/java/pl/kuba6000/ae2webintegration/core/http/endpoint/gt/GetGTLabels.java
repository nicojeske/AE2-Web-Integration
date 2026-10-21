package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.gt.GTLabelStore;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Reads the machine nicknames, processing lines and tunnel line capacities the caller may see.
 *
 * They are shared by everyone who can see the machine or tunnel, unlike the per-player prefs.
 *
 * @response 200 {@link Response} Successful response.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/labels")
public final class GetGTLabels extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   visible labels: {@code machines} by machine id, {@code tunnels} by tunnel id
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, GTLabelStore.@NotNull Snapshot data) {}

    @Override
    protected void handleGT(WebPrincipal principal) {
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, GTLabelStore.snapshot(visibleTo(principal))));
    }
}
