package pl.kuba6000.ae2webintegration.core.ae2request.async;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;
import pl.kuba6000.ae2webintegration.core.utils.HTTPUtils;

public class GetItemHistory extends IAsyncRequest {

    private static final int DEFAULT_POINTS = 120;
    private static final int MAX_POINTS = 500;

    @Override
    public void handle(Map<String, String> getParams) {
        if (gridKey == -1) {
            deny("GRID_NOT_FOUND");
            return;
        }

        Long spanMillis = rangeToMillis(getParams.getOrDefault("range", "7d"));
        if (spanMillis == null) {
            deny("BAD_PARAM");
            return;
        }

        int points = DEFAULT_POINTS;
        if (getParams.containsKey("points")) {
            Integer parsed = HTTPUtils.parseInt(getParams.get("points"));
            if (parsed == null || parsed < 1) {
                deny("BAD_PARAM");
                return;
            }
            points = Math.min(parsed, MAX_POINTS);
        }

        // grid == null means the grid is real (access was already checked) but has never stored a
        // trackeditems entry - same as GetTrackingHistory's own "grid == null" branch, an honest empty
        // default rather than an error.
        Set<String> tracked = grid == null ? Collections.emptySet() : grid.getTrackedItems();
        List<String> itemids = resolveItemIds(getParams.get("items"), tracked);

        long now = System.currentTimeMillis();
        succeed(ItemHistoryStore.readSeries(gridKey, itemids, now - spanMillis, now, points));
    }

    private static List<String> resolveItemIds(String csv, Set<String> tracked) {
        if (csv == null || csv.isEmpty()) {
            return new ArrayList<>(tracked);
        }
        Set<String> requested = new LinkedHashSet<>();
        for (String raw : csv.split(",")) {
            String itemid = raw.trim();
            if (!itemid.isEmpty()) {
                requested.add(itemid);
            }
        }
        return new ArrayList<>(requested);
    }

    /** "all" is honestly labelled: it maps to the full configured retention, not an unbounded range. */
    private static Long rangeToMillis(String range) {
        switch (range) {
            case "24h":
                return TimeUnit.HOURS.toMillis(24);
            case "7d":
                return TimeUnit.DAYS.toMillis(7);
            case "30d":
                return TimeUnit.DAYS.toMillis(30);
            case "1y":
                return TimeUnit.DAYS.toMillis(365);
            case "all":
                return TimeUnit.DAYS.toMillis(Config.STATISTICS_HOURLY_RETENTION_DAYS());
            default:
                return null;
        }
    }
}
