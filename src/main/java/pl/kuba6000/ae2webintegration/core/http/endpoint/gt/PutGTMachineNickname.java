package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.gt.GTLabelStore;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Body;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;

/**
 * Sets a machine's nickname, shared by everyone who can see the machine. A blank value clears it.
 *
 * @pathParam machineId Machine id, as listed by the machines endpoint.
 * @response 200 {@link Response} The machine's labels as stored.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value, unexpected body or invalid JSON/input
 *           fields.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} CSRF_REJECTED: cookie or configured-local mutations require
 *           X-AE2-Request: true.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled. NOT_FOUND
 *           when the target does not exist or is not visible.
 * @response 405 {@link ErrorResponse} METHOD_NOT_ALLOWED: this path does not support the method; Allow lists
 *           supported methods.
 * @response 413 {@link ErrorResponse} REQUEST_TOO_LARGE: the request body exceeds 8192 bytes.
 * @response 415 {@link ErrorResponse} UNSUPPORTED_MEDIA_TYPE: a nonempty request body requires Content-Type:
 *           application/json.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"CSRF_REJECTED","data":null}
 * @responseExample 404 {"status":"NOT_FOUND","data":null}
 * @responseExample 405 {"status":"METHOD_NOT_ALLOWED","data":null}
 * @responseExample 413 {"status":"REQUEST_TOO_LARGE","data":null}
 * @responseExample 415 {"status":"UNSUPPORTED_MEDIA_TYPE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.PUT, path = "/api/gt/machines/{machineId}/nickname")
public final class PutGTMachineNickname extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   the machine's nickname and line, {@code null} when it has neither
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, GTLabelStore.@Nullable MachineLabels data) {}

    public static final class Input {

        /**
         * Nickname shown instead of the machine's own name, at most 64 characters; blank clears it.
         *
         * @example EBF #2
         */
        public String name;
    }

    @PathParam("machineId")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String machineId;

    @Body
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull Input input;

    @Override
    protected void handleGT(WebPrincipal principal) {
        if (!GTLabelStore.machineVisible(machineId, visibleTo(principal))) {
            deny(ApiStatus.NOT_FOUND);
            return;
        }
        GTLabelStore.setNickname(machineId, input.name);
        GTLabelStore.flushIfDirty();
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, GTLabelStore.of(machineId)));
    }
}
