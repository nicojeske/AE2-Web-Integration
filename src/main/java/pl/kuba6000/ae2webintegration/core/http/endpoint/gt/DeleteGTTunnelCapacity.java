package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.gt.GTLabelStore;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;

/**
 * Forgets what an EU P2P tunnel's line is built for.
 *
 * @pathParam tunnelId Tunnel id, as listed by the tunnels endpoint.
 * @response 200 {@link Response} The capacity was cleared.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value, or unexpected body.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} CSRF_REJECTED: cookie or configured-local mutations require
 *           X-AE2-Request: true.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled. NOT_FOUND
 *           when the tunnel is not visible or has no capacity set.
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
@Endpoint(method = HttpMethod.DELETE, path = "/api/gt/tunnels/{tunnelId}/capacity")
public final class DeleteGTTunnelCapacity extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   always {@code null} after the capacity is cleared
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
        if (!GTLabelStore.tunnelVisible(tunnelId, visibleTo(principal)) || !GTLabelStore.clearCapacity(tunnelId)) {
            deny(ApiStatus.NOT_FOUND);
            return;
        }
        GTLabelStore.flushIfDirty();
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, null));
    }
}
