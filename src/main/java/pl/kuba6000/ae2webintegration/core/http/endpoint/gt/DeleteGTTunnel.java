package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.gt.GTTunnelStore;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;

/**
 * Removes an EU P2P tunnel from the list, e.g. one that was broken or linked as an output since.
 * <p>
 * Its history stays and ages out. A tunnel still loaded as an input comes back on the next scan.
 *
 * @pathParam tunnelId Tunnel id, as listed by the tunnels endpoint.
 * @response 200 {@link Response} The tunnel was removed.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or unexpected body.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} CSRF_REJECTED: cookie or configured-local mutations require
 *           X-AE2-Request: true.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled. NOT_FOUND
 *           when the tunnel does not exist or is not visible.
 * @response 405 {@link ErrorResponse} METHOD_NOT_ALLOWED: this path does not support the method; Allow lists
 *           supported methods.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"CSRF_REJECTED","data":null}
 * @responseExample 404 {"status":"NOT_FOUND","data":null}
 * @responseExample 405 {"status":"METHOD_NOT_ALLOWED","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.DELETE, path = "/api/gt/tunnels/{tunnelId}")
public final class DeleteGTTunnel extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   always {@code null} after the tunnel is removed
     * @example status OK
     * @example data null
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @Nullable Void data) {}

    @PathParam("tunnelId")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String tunnelId;

    @Override
    protected void handleGT(WebPrincipal principal) {
        GTTunnelStore.View tunnel = GTTunnelStore.latest(tunnelId);
        if (tunnel == null || !GTVisibility.canSee(principal, tunnel.snapshot.owner)
            || !GTTunnelStore.remove(tunnelId)) {
            deny(ApiStatus.NOT_FOUND);
            return;
        }
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, null));
    }
}
