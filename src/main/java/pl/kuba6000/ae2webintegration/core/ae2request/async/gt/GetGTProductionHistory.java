package pl.kuba6000.ae2webintegration.core.ae2request.async.gt;

import java.util.Map;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.gt.GTProductionLog;

/**
 * {@code /gt/productionhistory?[item=<stack id>][&machine=<id>]&range=7d[&points=120]}: amount produced
 * per window, summed over the visible machines. Without {@code item} it sums every stack, which is only
 * meaningful together with {@code machine}.
 */
public class GetGTProductionHistory extends GTRequest {

    @Override
    protected void handleGT(Map<String, String> getParams, WebPrincipal principal) {
        Long span = parseRange(getParams, "7d", GetGTProduction.maxRangeMillis());
        Integer points = parsePoints(getParams);
        if (span == null || points == null) {
            deny("BAD_PARAM");
            return;
        }
        long now = System.currentTimeMillis();
        succeed(
            GTProductionLog.series(
                emptyToNull(getParams.get("item")),
                emptyToNull(getParams.get("machine")),
                now - span,
                now,
                now,
                points,
                visibleTo(principal)));
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }
}
