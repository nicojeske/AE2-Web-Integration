package pl.kuba6000.ae2webintegration.core.http.endpoint.prefs;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.CoreData;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Body;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Replaces the web terminal preferences synced for the signed-in account.
 * <p>
 * The body limit is far larger than any other endpoint's: a preferences blob holds an unbounded number of
 * favourited items and saved compare views.
 *
 * @response 200 {@link GetPrefs.Response} Successful response with the stored preferences.
 * @response 400 {@link ErrorResponse} BAD_PARAM: missing or invalid body.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 403 {@link ErrorResponse} CSRF_REJECTED: a cookie-authenticated request lacked the X-AE2-Request header.
 * @response 413 {@link ErrorResponse} REQUEST_TOO_LARGE: the request body exceeds 524288 bytes.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"CSRF_REJECTED","data":null}
 * @responseExample 413 {"status":"REQUEST_TOO_LARGE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
// JSON string escaping can double a blob's size on the wire.
@Endpoint(method = HttpMethod.PUT, path = "/api/prefs", maxBodyBytes = 512 * 1024)
public final class PutPrefs extends IAsyncRequest {

    /** Preferences to store. */
    public static final class Input {

        /**
         * JSON document to store as-is.
         *
         * @example {"favorites":[]}
         */
        public String blob;
    }

    @Body
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull Input input;

    @Override
    public void handle() {
        CoreData.setPrefsBlob(
            context.getPrincipal()
                .prefsKey(),
            input.blob);
        respond(HttpURLConnection.HTTP_OK, GetPrefs.current(context.getPrincipal()));
    }
}
