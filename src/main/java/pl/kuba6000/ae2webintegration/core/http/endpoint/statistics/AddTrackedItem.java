package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;

/**
 * Starts sampling stored-count history for one item; does nothing when it is already tracked.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @pathParam itemid Item id, as listed by the grid's items.
 * @response 200 {@link TrackedItems.Response} Successful response.
 * @response 409 {@link ErrorResponse} TRACKED_LIMIT_REACHED: the grid already tracks the maximum number of items.
 * @responseExample 409 {"status":"TRACKED_LIMIT_REACHED","data":null}
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
@Endpoint(method = HttpMethod.PUT, path = "/api/grids/{gridKey}/tracked-items/{itemid}")
public final class AddTrackedItem extends TrackedItems {

    @PathParam("itemid")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String itemid;

    @Override
    public void handle() {
        String valid = validItemId(itemid);
        if (valid == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        respondWith(current -> {
            current.add(valid);
            return current;
        });
    }
}
