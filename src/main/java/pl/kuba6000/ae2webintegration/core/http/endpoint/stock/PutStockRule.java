package pl.kuba6000.ae2webintegration.core.http.endpoint.stock;

import java.io.IOException;
import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.grid.StockRule;
import pl.kuba6000.ae2webintegration.core.grid.StockRulesData;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Body;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.stock.StockKeeper;

/**
 * Creates or replaces one item's stock rule on a grid.
 * <p>
 * The rule is shared by everyone with access to the grid, and takes effect at the server's next check.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @pathParam itemid Item the rule is for, in the same format as an item's {@code itemid}.
 * @response 200 {@link Response} The rule as stored.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value, unexpected body, invalid JSON/input
 *           fields, a negative amount, a batch size below 1, or a grid that already has 500 rules.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} NO_PERMISSIONS: the user cannot access this grid. CSRF_REJECTED: cookie or
 *           configured-local mutations require X-AE2-Request: true.
 * @response 404 {@link ErrorResponse} GRID_NOT_FOUND: the grid does not exist.
 * @response 405 {@link ErrorResponse} METHOD_NOT_ALLOWED: this path does not support the method; Allow lists
 *           supported methods.
 * @response 413 {@link ErrorResponse} REQUEST_TOO_LARGE: the request body exceeds 8192 bytes.
 * @response 415 {@link ErrorResponse} UNSUPPORTED_MEDIA_TYPE: a nonempty request body requires Content-Type:
 *           application/json.
 * @response 429 {@link ErrorResponse} TOO_MANY_REQUESTS: the unauthenticated request rate limit was exceeded.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed because of an unexpected
 *           failure.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"NO_PERMISSIONS","data":null}
 * @responseExample 404 {"status":"GRID_NOT_FOUND","data":null}
 * @responseExample 405 {"status":"METHOD_NOT_ALLOWED","data":null}
 * @responseExample 413 {"status":"REQUEST_TOO_LARGE","data":null}
 * @responseExample 415 {"status":"UNSUPPORTED_MEDIA_TYPE","data":null}
 * @responseExample 429 {"status":"TOO_MANY_REQUESTS","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.PUT, path = "/api/grids/{gridKey}/stock-rules/{itemid}")
public final class PutStockRule extends IAsyncRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   the rule as stored, with the server's last check of the item
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, GetStockRules.@NotNull StockRuleView data) {}

    /** The whole rule; every member is required. */
    public static final class Input {

        /**
         * Notify once when the stored amount drops below this; 0 never alerts.
         *
         * @example 100
         */
        public long alertBelow;

        /**
         * Auto-craft tops the stored amount back up to this.
         *
         * @example 200
         */
        public long keepStock;

        /**
         * Most one auto-craft orders at a time; at least 1.
         *
         * @example 64
         */
        public long batchSize;

        /**
         * Whether the server crafts the item when it is below {@code keepStock}.
         *
         * @example true
         */
        public boolean autoCraft;
    }

    @PathParam("itemid")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String itemid;

    @Body
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull Input input;

    @Override
    public void handle() {
        if (gridKey == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }
        StockRule rule = new StockRule(input.alertBelow, input.keepStock, input.batchSize, input.autoCraft);
        if (!StockRulesData.isValidItemId(itemid) || !rule.isValid()) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        GridIdentityRegistry registry = CoreEngine.GRID_IDENTITIES;
        synchronized (registry) {
            GridPersistentData data = registry.getPersistentData(gridKey);
            if (data == null) {
                deny(ApiStatus.GRID_NOT_FOUND);
                return;
            }
            StockRulesData rules = data.getStockRules();
            if (!rules.put(itemid, rule)) {
                deny(ApiStatus.BAD_PARAM);
                return;
            }
            try {
                registry.saveIfDirty();
            } catch (IOException e) {
                deny(ApiStatus.INTERNAL_ERROR);
                return;
            }
            respond(
                HttpURLConnection.HTTP_OK,
                new Response(
                    ApiStatus.OK,
                    GetStockRules.StockRuleView.of(
                        itemid,
                        rule,
                        rules.isLow(itemid),
                        StockKeeper.status(gridKey)
                            .get(itemid))));
        }
    }
}
