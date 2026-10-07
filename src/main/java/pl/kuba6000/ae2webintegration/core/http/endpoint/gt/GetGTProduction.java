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
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTProductionLog;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

/**
 * Totals GregTech production over a range.
 *
 * Grouped by item (with a per-machine breakdown) or by machine (with a per-item breakdown), largest first.
 * 
 * @response 200 {@link Response} Successful response.
 * @response 400 {@link ErrorResponse} BAD_PARAM: malformed path value or query parameter.
 * @responseExample 400 {"status":"BAD_PARAM","data":null}
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/production")
public final class GetGTProduction extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   production totals over the requested range
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_GTProduction data) {}

    /** Time range ending now: 15m, 1h, 6h, 24h, 7d, 30d, 90d, all (the configured retention) or custom. */
    @QueryParam("range")
    @OptionalInput
    private String range = "24h";

    /** Length of a {@code custom} range in minutes. */
    @QueryParam("minutes")
    @OptionalInput
    private @Nullable Integer minutes;

    /** {@code item} or {@code machine}. */
    @QueryParam("groupBy")
    @OptionalInput
    private String groupBy = "item";

    /** Machine id to restrict the totals to. */
    @QueryParam("machine")
    @OptionalInput
    private @Nullable String machine;

    public static class JSON_GTProductionEntry {

        public String key;
        public String name;
        /** Only meaningful for items/fluids; {@code false} for a machine row. */
        public boolean fluid;
        public long total;
        /** {@code total} spread over the effective span; see {@link JSON_GTProduction#spanMillis}. */
        public double perHour;
        public List<JSON_GTProductionEntry> breakdown = new ArrayList<>();
    }

    public static class JSON_GTProduction {

        /** Start of the first bucket counted - may be earlier than requested, buckets are whole hours/days. */
        public long from;
        public long to;
        /**
         * Span {@code perHour} is computed over: the requested range, shortened when recording started inside
         * it so a fresh install does not under-report its rates, but never below five minutes.
         */
        public long spanMillis;
        public long trackingSince;
        public String resolution;
        public String groupBy;
        public List<JSON_GTProductionEntry> rows = new ArrayList<>();
    }

    /**
     * Floor for {@link JSON_GTProduction#spanMillis}, so the first recipe after recording starts does not read
     * as millions per hour. Under-reports for the first five minutes instead, which settles on its own.
     */
    static final long MIN_RATE_SPAN_MILLIS = TimeUnit.MINUTES.toMillis(5);

    @Override
    protected void handleGT(WebPrincipal principal) {
        Long span = parseRange(range, minutes, maxRangeMillis());
        if (span == null || !(groupBy.equals("item") || groupBy.equals("machine"))) {
            deny(ApiStatus.BAD_PARAM);
            return;
        }
        long now = System.currentTimeMillis();
        respond(
            HttpURLConnection.HTTP_OK,
            new Response(ApiStatus.OK, build(now - span, now, now, groupBy, machine, principal)));
    }

    static long maxRangeMillis() {
        return TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionDailyRetentionDays);
    }

    static JSON_GTProduction build(long fromMillis, long toMillis, long nowMillis, String groupBy, String machineId,
        WebPrincipal principal) {
        boolean hourly = fromMillis
            >= nowMillis - TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionHourlyRetentionDays);
        long bucketMillis = hourly ? TimeUnit.HOURS.toMillis(1) : TimeUnit.DAYS.toMillis(1);

        JSON_GTProduction result = new JSON_GTProduction();
        result.groupBy = groupBy;
        result.resolution = hourly ? "hourly" : "daily";
        result.from = Math.floorDiv(fromMillis, bucketMillis) * bucketMillis;
        result.to = toMillis;
        result.trackingSince = GTProductionLog.trackingSinceMillis();
        long effectiveFrom = result.trackingSince > 0 ? Math.max(fromMillis, result.trackingSince) : fromMillis;
        result.spanMillis = Math.max(MIN_RATE_SPAN_MILLIS, toMillis - effectiveFrom);
        double hours = result.spanMillis / (double) TimeUnit.HOURS.toMillis(1);

        boolean byItem = groupBy.equals("item");
        Map<String, JSON_GTProductionEntry> groups = new LinkedHashMap<>();
        for (GTProductionLog.Row row : GTProductionLog
            .totals(fromMillis, toMillis, nowMillis, visibleTo(principal), machineId)) {
            String groupKey = byItem ? row.stackId : row.machineId;
            JSON_GTProductionEntry group = groups.computeIfAbsent(groupKey, k -> {
                JSON_GTProductionEntry entry = new JSON_GTProductionEntry();
                entry.key = k;
                entry.name = byItem ? row.stackName : row.machineName;
                entry.fluid = byItem && row.fluid;
                return entry;
            });
            group.total += row.total;

            JSON_GTProductionEntry detail = new JSON_GTProductionEntry();
            detail.key = byItem ? row.machineId : row.stackId;
            detail.name = byItem ? row.machineName : row.stackName;
            detail.fluid = !byItem && row.fluid;
            detail.total = row.total;
            detail.perHour = row.total / hours;
            group.breakdown.add(detail);
        }
        Comparator<JSON_GTProductionEntry> largestFirst = Comparator
            .comparingLong((JSON_GTProductionEntry e) -> e.total)
            .reversed()
            .thenComparing(e -> e.key);
        for (JSON_GTProductionEntry group : groups.values()) {
            group.perHour = group.total / hours;
            group.breakdown.sort(largestFirst);
            result.rows.add(group);
        }
        result.rows.sort(largestFirst);
        return result;
    }
}
