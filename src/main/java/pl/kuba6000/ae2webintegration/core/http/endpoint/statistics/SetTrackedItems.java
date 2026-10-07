package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.util.LinkedHashSet;
import java.util.Set;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Body;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Replaces the items a grid samples stored-count history for, in the given order.
 *
 * @pathParam gridKey Persistent grid identifier.
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
@Endpoint(method = HttpMethod.PUT, path = "/api/grids/{gridKey}/tracked-items")
public final class SetTrackedItems extends TrackedItems {

    /** The new tracked set. */
    public static final class Input {

        /**
         * Comma-separated item ids; empty clears the set.
         *
         * @example minecraft:iron_ingot:0,minecraft:gold_ingot:0
         */
        public String items;
    }

    @Body
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull Input input;

    @Override
    public void handle() {
        respondWith(current -> {
            Set<String> next = new LinkedHashSet<>();
            for (String raw : input.items.split(",")) {
                if (raw.trim()
                    .isEmpty()) continue;
                String itemid = validItemId(raw);
                if (itemid == null) return null;
                next.add(itemid);
            }
            return next;
        });
    }
}
