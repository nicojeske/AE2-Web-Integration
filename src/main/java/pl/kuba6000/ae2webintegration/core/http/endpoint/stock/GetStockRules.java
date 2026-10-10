package pl.kuba6000.ae2webintegration.core.http.endpoint.stock;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.grid.StockRule;
import pl.kuba6000.ae2webintegration.core.grid.StockRulesData;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.stock.StockKeeper;

/**
 * Lists a grid's stock rules with the server's last check of each.
 * <p>
 * Rules are shared by everyone with access to the grid. The server checks them every
 * {@code stock.check_interval_seconds}, without a browser open.
 *
 * @pathParam gridKey Persistent grid identifier.
 * @response 200 {@link Response} The grid's stock rules, in the order they were added.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value, unexpected body, or invalid JSON/input
 *           fields.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided; response includes
 *           WWW-Authenticate: Bearer.
 * @response 403 {@link ErrorResponse} NO_PERMISSIONS: the user cannot access this grid.
 * @response 404 {@link ErrorResponse} GRID_NOT_FOUND: the grid does not exist.
 * @response 405 {@link ErrorResponse} METHOD_NOT_ALLOWED: this path does not support the method; Allow lists
 *           supported methods.
 * @response 413 {@link ErrorResponse} REQUEST_TOO_LARGE: the request body exceeds 8192 bytes.
 * @response 429 {@link ErrorResponse} TOO_MANY_REQUESTS: the unauthenticated request rate limit was exceeded.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed because of an unexpected
 *           failure.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 403 {"status":"NO_PERMISSIONS","data":null}
 * @responseExample 404 {"status":"GRID_NOT_FOUND","data":null}
 * @responseExample 405 {"status":"METHOD_NOT_ALLOWED","data":null}
 * @responseExample 413 {"status":"REQUEST_TOO_LARGE","data":null}
 * @responseExample 429 {"status":"TOO_MANY_REQUESTS","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/grids/{gridKey}/stock-rules")
public final class GetStockRules extends IAsyncRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   every stock rule of the grid
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull List<StockRuleView> data) {}

    /**
     * One stock rule and the server's last check of it.
     *
     * @param itemid       the item, in the same format as an item's {@code itemid}
     * @param alertBelow   notify once when the stored amount drops below this; 0 never alerts
     * @param keepStock    auto-craft tops the stored amount back up to this
     * @param batchSize    most one auto-craft orders at a time
     * @param autoCraft    whether the server crafts the item when it is below {@code keepStock}
     * @param stored       stored amount at the last check, or -1 before the first one
     * @param low          whether the stored amount is below {@code alertBelow}
     * @param crafting     whether a CPU is crafting the item, or an auto-craft plan for it is computing
     * @param lastAttempt  epoch millis of the last auto-craft attempt, 0 if none
     * @param lastError    why the last auto-craft attempt failed; null when it succeeded or none was made
     * @param backoffUntil epoch millis before which no new auto-craft attempt starts, 0 if none
     * @example itemid minecraft:iron_ingot:0
     * @example alertBelow 100
     * @example keepStock 200
     * @example batchSize 64
     * @example autoCraft true
     * @example stored 37
     * @example low true
     * @example crafting false
     * @example lastAttempt 1760000000000
     * @example lastError Missing ingredients
     * @example backoffUntil 1760000300000
     */
    @Desugar
    public record StockRuleView(@NotNull String itemid, long alertBelow, long keepStock, long batchSize,
        boolean autoCraft, long stored, boolean low, boolean crafting, long lastAttempt, @Nullable String lastError,
        long backoffUntil) {

        static @NotNull StockRuleView of(@NotNull String itemid, @NotNull StockRule rule, boolean low,
            StockKeeper.@Nullable RuleStatus status) {
            return status == null
                ? new StockRuleView(
                    itemid,
                    rule.alertBelow(),
                    rule.keepStock(),
                    rule.batchSize(),
                    rule.autoCraft(),
                    -1L,
                    low,
                    false,
                    0L,
                    null,
                    0L)
                : new StockRuleView(
                    itemid,
                    rule.alertBelow(),
                    rule.keepStock(),
                    rule.batchSize(),
                    rule.autoCraft(),
                    status.stored(),
                    low,
                    status.crafting(),
                    status.lastAttempt(),
                    status.lastError(),
                    status.backoffUntil());
        }
    }

    @Override
    public void handle() {
        if (gridKey == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }
        Map<String, StockKeeper.RuleStatus> status = StockKeeper.status(gridKey);
        List<StockRuleView> views = new ArrayList<>();
        GridIdentityRegistry registry = CoreEngine.GRID_IDENTITIES;
        synchronized (registry) {
            GridPersistentData data = registry.getPersistentData(gridKey);
            if (data == null) {
                deny(ApiStatus.GRID_NOT_FOUND);
                return;
            }
            StockRulesData rules = data.getStockRules();
            for (Map.Entry<String, StockRule> entry : rules.rules()
                .entrySet()) {
                String itemid = entry.getKey();
                views.add(StockRuleView.of(itemid, entry.getValue(), rules.isLow(itemid), status.get(itemid)));
            }
        }
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, views));
    }
}
