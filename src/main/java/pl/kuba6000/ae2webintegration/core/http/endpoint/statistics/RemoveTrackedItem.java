package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;

/**
 * Stops sampling stored-count history for one item and drops its recorded history.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @pathParam itemid Item id, as listed by the grid's items.
 * @response 200 {@link TrackedItems.Response} Successful response.
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
@Endpoint(method = HttpMethod.DELETE, path = "/api/grids/{gridKey}/tracked-items/{itemid}")
public final class RemoveTrackedItem extends TrackedItems {

    @PathParam("itemid")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String itemid;

    @Override
    public void handle() {
        respondWith(current -> {
            current.remove(itemid.trim());
            return current;
        });
    }
}
