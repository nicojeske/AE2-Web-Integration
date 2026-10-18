package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTStateLog;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * How long each visible GregTech machine spent in each status over a range, as observed by the scans (unloaded
 * machines are not observed). Most running time share first.
 *
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed query parameter.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 *           HISTORY_DISABLED when no history database is configured.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/machine-states")
public final class GetGTMachineStates extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   time per status for each machine observed in the range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull List<JSON_GTMachineStates> data) {}

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 90d, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "7d";

    /** Length of a {@code custom} range in minutes. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    public static class JSON_GTMachineStates {

        /**
         * Machine id, {@code dim:x:y:z} of the controller.
         *
         * @example 0:100:64:-20
         */
        public String id;
        /**
         * Localized machine name.
         *
         * @example Electric Blast Furnace
         */
        public String name;
        /**
         * Owner's player name; null when unknown.
         *
         * @example Steve
         */
        public @Nullable String ownerName;
        /**
         * Voltage tier index (0 = ULV ... 6 = LuV); -1 if unknown.
         *
         * @example 5
         */
        public int voltageTier;
        /**
         * Observed time in the range, the sum of {@code states}.
         *
         * @example 86400000
         */
        public long observedMillis;
        /**
         * Share of observed time spent running a recipe, 0-1.
         *
         * @example 0.95
         */
        public double runningShare;
        /** Milliseconds per status, keyed by the lower-case status name ({@code running}, {@code no_power}, ...). */
        public Map<String, Long> states = new LinkedHashMap<>();
        /**
         * Idle time split by why no recipe ran, keyed by GregTech's recipe check id ({@code no_recipe},
         * {@code missing_item}, {@code insufficient_voltage}, ...); part of {@code states.idle}, which may hold
         * more where no reason was known.
         */
        public Map<String, Long> idleReasons = new LinkedHashMap<>();
    }

    @Override
    protected void handleGT(WebPrincipal principal) {
        Long span = parseRange(range, minutes, TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.stateRetentionDays));
        if (span == null) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        if (HistoryDb.get() == null) {
            deny(ApiStatus.HISTORY_DISABLED);
            return;
        }
        long now = System.currentTimeMillis();
        List<JSON_GTMachineStates> rows = new ArrayList<>();
        for (Map.Entry<String, Map<String, Long>> entry : GTStateLog.totals(now - span, now, visibleTo(principal))
            .entrySet()) {
            GTMachineSnapshot machine = GTMachineRegistry.get(entry.getKey());
            if (machine == null) continue;
            JSON_GTMachineStates row = new JSON_GTMachineStates();
            row.id = machine.id;
            row.name = machine.name;
            row.ownerName = machine.ownerName;
            row.voltageTier = machine.voltageTier;
            for (GTMachineStatus status : GTMachineStatus.values()) {
                Long millis = entry.getValue()
                    .get(GTStateLog.key(status));
                if (millis != null && millis > 0) {
                    row.states.put(GTStateLog.key(status), millis);
                    row.observedMillis += millis;
                }
            }
            if (row.observedMillis == 0) continue;
            entry.getValue()
                .entrySet()
                .stream()
                .filter(
                    e -> e.getKey()
                        .startsWith(GTStateLog.IDLE_REASON_PREFIX) && e.getValue() > 0)
                .sorted(
                    Map.Entry.<String, Long>comparingByValue()
                        .reversed())
                .forEach(
                    e -> row.idleReasons.put(
                        e.getKey()
                            .substring(GTStateLog.IDLE_REASON_PREFIX.length()),
                        e.getValue()));
            row.runningShare = row.states.getOrDefault(GTStateLog.key(GTMachineStatus.RUNNING), 0L)
                / (double) row.observedMillis;
            rows.add(row);
        }
        rows.sort(
            Comparator.comparingDouble((JSON_GTMachineStates r) -> r.runningShare)
                .reversed()
                .thenComparing(r -> r.id));
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, rows));
    }
}
