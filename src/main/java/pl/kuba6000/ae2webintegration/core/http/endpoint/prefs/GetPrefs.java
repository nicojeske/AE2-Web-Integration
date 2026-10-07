package pl.kuba6000.ae2webintegration.core.http.endpoint.prefs;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.CoreData;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Reads the web terminal preferences synced for the signed-in account.
 * <p>
 * Favourites, thresholds, browser filters and saved statistics views follow the account across devices. The
 * server stores the blob opaquely and never parses it, so a frontend change to what it syncs never needs a
 * server change. Administrator and trusted-local access share one blob.
 *
 * @response 200 {@link Response} Successful response.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/prefs")
public final class GetPrefs extends IAsyncRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   the stored preferences
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull Prefs data) {}

    /**
     * Stored preferences of one account.
     *
     * @param blob the last stored JSON document, or null when nothing was synced yet
     * @example blob {"favorites":[]}
     */
    @Desugar
    public record Prefs(@Nullable String blob) {}

    @Override
    public void handle() {
        respond(HttpURLConnection.HTTP_OK, current(context.getPrincipal()));
    }

    static Response current(WebPrincipal principal) {
        return new Response(ApiStatus.OK, new Prefs(CoreData.getPrefsBlob(principal.prefsKey())));
    }
}
