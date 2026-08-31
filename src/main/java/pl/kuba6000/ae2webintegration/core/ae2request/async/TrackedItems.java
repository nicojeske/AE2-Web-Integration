package pl.kuba6000.ae2webintegration.core.ae2request.async;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import pl.kuba6000.ae2webintegration.core.GridData;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;

public class TrackedItems extends IAsyncRequest {

    private static final int MAX_ITEMID_LENGTH = 256;

    private static class JSON_TrackedItemsResult {

        ArrayList<String> tracked;
        int limit;

        JSON_TrackedItemsResult(Set<String> tracked, int limit) {
            this.tracked = new ArrayList<>(tracked);
            this.limit = limit;
        }
    }

    @Override
    public void handle(Map<String, String> getParams) {
        if (gridKey == -1) {
            deny("GRID_NOT_FOUND");
            return;
        }

        int limit = Config.STATISTICS_MAX_TRACKED_ITEMS_PER_GRID();

        if (getParams.containsKey("set") || getParams.containsKey("add") || getParams.containsKey("remove")) {
            // Access was already verified against the live grids, so creating the entry here is safe -
            // this is one of the two async endpoints that legitimately store something (see GridSettings).
            GridData stored = GridData.getOrCreate(gridKey);
            Set<String> next = new LinkedHashSet<>(stored.getTrackedItems());

            if (getParams.containsKey("set")) {
                List<String> parsed = parseCsv(getParams.get("set"));
                for (String itemid : parsed) {
                    if (itemid.length() > MAX_ITEMID_LENGTH) {
                        deny("BAD_PARAM");
                        return;
                    }
                }
                next = new LinkedHashSet<>(parsed);
            }
            if (getParams.containsKey("add")) {
                String itemid = getParams.get("add")
                    .trim();
                if (itemid.isEmpty() || itemid.length() > MAX_ITEMID_LENGTH) {
                    deny("BAD_PARAM");
                    return;
                }
                next.add(itemid);
            }
            if (getParams.containsKey("remove")) {
                next.remove(
                    getParams.get("remove")
                        .trim());
            }

            if (next.size() > limit) {
                deny("TRACKED_LIMIT_REACHED");
                return;
            }

            stored.setTrackedItems(next);
            GridData.saveChanges();
            ItemHistoryStore.pruneTo(gridKey, stored.getTrackedItems());
            grid = stored;
        }

        succeed(new JSON_TrackedItemsResult(grid != null ? grid.getTrackedItems() : Collections.emptySet(), limit));
    }

    private static List<String> parseCsv(String csv) {
        List<String> result = new ArrayList<>();
        if (csv == null) {
            return result;
        }
        for (String raw : csv.split(",")) {
            String itemid = raw.trim();
            if (!itemid.isEmpty()) {
                result.add(itemid);
            }
        }
        return result;
    }
}
