package pl.kuba6000.ae2webintegration.core.ae2request.async.gt;

import java.util.Map;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTPowerHistoryStore;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;

/**
 * {@code /gt/powerhistory?source=<id>&range=24h[&points=120]}. Values are longs saturated at
 * {@link Long#MAX_VALUE}; -1 = no sample. Only sources currently known (in {@code /gt/power}) are served,
 * since visibility needs the owner.
 */
public class GetGTPowerHistory extends GTRequest {

    @Override
    protected void handleGT(Map<String, String> getParams, WebPrincipal principal) {
        String sourceId = getParams.get("source");
        if (sourceId == null || sourceId.isEmpty()) {
            noParam("source");
            return;
        }
        Long span = parseRange(getParams, "24h", TimeUnit.DAYS.toMillis(Config.GT_POWER_HOURLY_RETENTION_DAYS()));
        Integer points = parsePoints(getParams);
        if (span == null || points == null) {
            deny("BAD_PARAM");
            return;
        }
        GTPowerSourceSnapshot source = GTPowerHistoryStore.latest(sourceId);
        if (source == null || !GTVisibility.canSee(principal, source.owner)) {
            deny("NOT_FOUND");
            return;
        }
        long now = System.currentTimeMillis();
        succeed(GTPowerHistoryStore.read(sourceId, now - span, now, points));
    }
}
