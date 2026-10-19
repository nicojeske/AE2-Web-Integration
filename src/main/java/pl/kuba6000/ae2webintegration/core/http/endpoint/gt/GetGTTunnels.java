package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.jetbrains.annotations.NotNull;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTEnergyTunnelSnapshot;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTTunnelStore;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.http.ErrorResponse;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;

/**
 * Reads the throughput of every EU P2P tunnel the caller may see.
 *
 * Rates are averages over the last five minutes, in EU/t and amps (packets per tick), plus the share of ticks the
 * outputs took every amp the line offered; {@code null} until two scans in a row saw the tunnel.
 *
 * @response 200 {@link Response} Successful response.
 * @response 401 {@link ErrorResponse} UNAUTHORIZED: no valid session was provided.
 * @response 404 {@link ErrorResponse} NOT_AVAILABLE: GregTech is not installed or its pages are disabled.
 * @response 500 {@link ErrorResponse} INTERNAL_ERROR: the request could not be completed.
 * @responseExample 401 {"status":"UNAUTHORIZED","data":null}
 * @responseExample 404 {"status":"NOT_AVAILABLE","data":null}
 * @responseExample 500 {"status":"INTERNAL_ERROR","data":null}
 */
@Endpoint(method = HttpMethod.GET, path = "/api/gt/tunnels")
public final class GetGTTunnels extends GTRequest {

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   visible EU P2P tunnels
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull JSON_GTTunnels data) {}

    public static class JSON_GTTunnel {

        public String id;
        /** The input part's custom name; {@code null} when it has none. */
        public String name;
        public UUID owner;
        public String ownerName;
        public long frequency;
        public int outputs;
        /** Voltage of the last packet, 0 before the first one. */
        public long voltage;
        /** Average EU/t moved. */
        public Double euPerTick;
        /** Average amps moved. */
        public Double amps;
        /** Busiest single scan in the window, in amps. */
        public Double peakAmps;
        /** 0..1: share of ticks the outputs took every amp the line offered, i.e. the line was maxed out. */
        public Double maxedShare;
        public int dim;
        public String dimName;
        public int x;
        public int y;
        public int z;
        public String side;
        public long sampledAt;
        /** Whether the tunnel was part of the most recent scan. */
        public boolean loaded;
    }

    public static class JSON_GTTunnels {

        public List<JSON_GTTunnel> tunnels = new ArrayList<>();
    }

    @Override
    protected void handleGT(WebPrincipal principal) {
        JSON_GTTunnels result = new JSON_GTTunnels();
        long lastScan = GTEngine.lastScanMillis();
        for (GTTunnelStore.View view : GTTunnelStore.latest()) {
            GTEnergyTunnelSnapshot tunnel = view.snapshot;
            if (!GTVisibility.canSee(principal, tunnel.owner)) {
                continue;
            }
            JSON_GTTunnel json = new JSON_GTTunnel();
            json.id = tunnel.id;
            json.name = tunnel.name;
            json.owner = tunnel.owner;
            json.ownerName = tunnel.ownerName;
            json.frequency = tunnel.frequency;
            json.outputs = tunnel.outputs;
            json.voltage = tunnel.voltage;
            json.euPerTick = view.euPerTick;
            json.amps = amps(view.euPerTick, tunnel.voltage);
            json.peakAmps = amps(view.peakEuPerTick, tunnel.voltage);
            json.maxedShare = view.maxedShare;
            json.dim = tunnel.dim;
            json.dimName = tunnel.dimName;
            json.x = tunnel.x;
            json.y = tunnel.y;
            json.z = tunnel.z;
            json.side = tunnel.side;
            json.sampledAt = view.sampledAt;
            json.loaded = view.sampledAt == lastScan;
            result.tunnels.add(json);
        }
        result.tunnels.sort(
            Comparator.comparing((JSON_GTTunnel t) -> t.name == null ? "￿" : t.name)
                .thenComparing(t -> t.id));
        respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, result));
    }

    private static Double amps(Double euPerTick, long voltage) {
        return euPerTick == null || voltage <= 0 ? null : euPerTick / voltage;
    }
}
