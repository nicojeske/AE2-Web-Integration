package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import org.jetbrains.annotations.NotNull;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Lists every GregTech machine the caller may see, problems first.
 *
 * @response 200 {@link Response} Successful response.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/machines")
public final class GetGTMachines extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   machines with a per-status summary of the loaded ones
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_GTMachines data) {}

    public static class JSON_GTMachines {

        public long scannedAt;
        public long scanMicros;
        public int unloaded;
        /** Count per status, loaded machines only; every status is present, zero or not. */
        public Map<GTMachineStatus, Integer> summary = new EnumMap<>(GTMachineStatus.class);
        public List<GTMachineSnapshot> machines = new ArrayList<>();
    }

    /** Loaded before unloaded, then status in declaration order (problems first), then name, then id. */
    static final Comparator<GTMachineSnapshot> ORDER = Comparator.comparing((GTMachineSnapshot m) -> !m.loaded)
        .thenComparing(m -> m.status == null ? GTMachineStatus.STOPPED : m.status)
        .thenComparing(m -> m.name == null ? "" : m.name)
        .thenComparing(m -> m.id);

    @Override
    protected void handleGT(WebPrincipal principal) {
        JSON_GTMachines result = new JSON_GTMachines();
        result.scannedAt = GTEngine.lastScanMillis();
        result.scanMicros = GTEngine.lastScanMicros();
        for (GTMachineStatus status : GTMachineStatus.values()) {
            result.summary.put(status, 0);
        }
        for (GTMachineSnapshot machine : GTMachineRegistry.all()) {
            if (!GTVisibility.canSee(principal, machine.owner)) {
                continue;
            }
            result.machines.add(machine);
            if (!machine.loaded) {
                result.unloaded++;
            } else if (machine.status != null) {
                result.summary.merge(machine.status, 1, Integer::sum);
            }
        }
        result.machines.sort(ORDER);
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, result));
    }
}
