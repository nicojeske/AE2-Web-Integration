package pl.kuba6000.ae2webintegration.core.ae2request.async.gt;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTPowerHistoryStore;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;

/**
 * {@code /gt/power}: current state of every power source the caller may see. EU amounts are decimal
 * strings (they overflow a JS number); rates and times are plain numbers.
 */
public class GetGTPower extends GTRequest {

    public static class JSON_GTPowerSource {

        public String id;
        public GTPowerSourceSnapshot.Kind kind;
        public String name;
        public UUID owner;
        public String ownerName;
        public String stored;
        /** {@code null} for wireless. */
        public String capacity;
        /** 0..1, {@code null} without a capacity. */
        public Double fill;
        public Long avgInPerTick;
        public Long avgOutPerTick;
        /** In minus out; see {@code GTPowerHistoryStore.netPerTick}. {@code null} until known. */
        public Long netPerTick;
        /** Seconds until empty at the current net rate; {@code null} unless draining. */
        public Long secondsToEmpty;
        /** Seconds until full at the current net rate; {@code null} unless filling with a capacity. */
        public Long secondsToFull;
        public Integer dim;
        public Integer x;
        public Integer y;
        public Integer z;
        public long sampledAt;
        /** Whether the source was part of the most recent scan. */
        public boolean loaded;
    }

    public static class JSON_GTPower {

        public List<JSON_GTPowerSource> sources = new ArrayList<>();
    }

    @Override
    protected void handleGT(Map<String, String> getParams, WebPrincipal principal) {
        JSON_GTPower result = new JSON_GTPower();
        long lastScan = GTEngine.lastScanMillis();
        for (GTPowerSourceSnapshot source : GTPowerHistoryStore.latest()) {
            if (!GTVisibility.canSee(principal, source.owner)) {
                continue;
            }
            JSON_GTPowerSource json = toJson(source, GTPowerHistoryStore.netPerTick(source));
            json.sampledAt = GTPowerHistoryStore.latestMillis(source.id);
            json.loaded = json.sampledAt == lastScan;
            result.sources.add(json);
        }
        result.sources.sort(
            Comparator.comparing((JSON_GTPowerSource s) -> s.kind)
                .thenComparing(s -> s.name == null ? "" : s.name)
                .thenComparing(s -> s.id));
        succeed(result);
    }

    static JSON_GTPowerSource toJson(GTPowerSourceSnapshot source, Long net) {
        JSON_GTPowerSource json = new JSON_GTPowerSource();
        json.id = source.id;
        json.kind = source.kind;
        json.name = source.name;
        json.owner = source.owner;
        json.ownerName = source.ownerName;
        BigInteger stored = source.stored == null ? BigInteger.ZERO : source.stored;
        json.stored = stored.toString();
        json.capacity = source.capacity == null ? null : source.capacity.toString();
        if (source.capacity != null && source.capacity.signum() > 0) {
            json.fill = new BigDecimal(stored).divide(new BigDecimal(source.capacity), 6, RoundingMode.HALF_UP)
                .min(BigDecimal.ONE)
                .max(BigDecimal.ZERO)
                .doubleValue();
        }
        json.avgInPerTick = source.avgInPerTick;
        json.avgOutPerTick = source.avgOutPerTick;
        json.netPerTick = net;
        if (net != null && net < 0) {
            json.secondsToEmpty = seconds(stored, -net);
        } else if (net != null && net > 0 && source.capacity != null) {
            json.secondsToFull = seconds(
                source.capacity.subtract(stored)
                    .max(BigInteger.ZERO),
                net);
        }
        json.dim = source.dim;
        json.x = source.x;
        json.y = source.y;
        json.z = source.z;
        return json;
    }

    /** {@code amount / perTick} ticks, as seconds (20 ticks/s), saturated at {@link Long#MAX_VALUE}. */
    static long seconds(BigInteger amount, long perTick) {
        BigInteger ticks = amount.divide(BigInteger.valueOf(perTick));
        BigInteger secs = ticks.divide(BigInteger.valueOf(20));
        return secs.bitLength() < 64 ? secs.longValue() : Long.MAX_VALUE;
    }
}
