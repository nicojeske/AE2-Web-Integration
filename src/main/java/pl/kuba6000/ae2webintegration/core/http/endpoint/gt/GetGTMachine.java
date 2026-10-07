package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * Reads one GregTech machine plus what it produced over a range.
 *
 * An invisible machine answers {@code NOT_FOUND}, same as a missing one, so ids cannot be probed.
 * 
 * @pathParam machineId Machine id, {@code dim:x:y:z} of its controller.
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or query parameter.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled. NOT_FOUND
 *           when the machine does not exist or is not visible.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/machines/{machineId}")
public final class GetGTMachine extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   the machine and its production totals
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_GTMachine data) {}

    @PathParam("machineId")
    @SuppressWarnings("NotNullFieldNotInitialized") // Bound before the request is handled.
    private @NotNull String id;

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 90d, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "24h";

    /** Length of a {@code custom} range in minutes. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    public static class JSON_GTMachine {

        public GTMachineSnapshot machine;
        public GetGTProduction.JSON_GTProduction production;
    }

    @Override
    protected void handleGT(WebPrincipal principal) {
        Long span = parseRange(range, minutes, GetGTProduction.maxRangeMillis());
        if (span == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        GTMachineSnapshot machine = GTMachineRegistry.get(id);
        if (machine == null || !GTVisibility.canSee(principal, machine.owner)) {
            deny(ApiStatus.NOT_FOUND);
            return;
        }
        long now = System.currentTimeMillis();
        JSON_GTMachine result = new JSON_GTMachine();
        result.machine = machine;
        result.production = GetGTProduction.build(now - span, now, now, "item", id, principal);
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, result));
    }
}
