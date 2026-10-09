package pl.kuba6000.ae2webintegration.core.api;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Wire shape for {@code GET /api/grids/{gridKey}/item-history}. Built by {@code ItemHistoryStore.readSeries}. */
public class JSON_ItemHistory {

    public static class JSON_ItemSeries {

        public String itemid;
        /** One entry per bucket from {@link #from} to {@link #to}, step {@link #stepMillis}. -1 = no sample. */
        public long[] points;

        public JSON_ItemSeries(String itemid, long[] points) {
            this.itemid = itemid;
            this.points = points;
        }
    }

    public long from;
    public long to;
    public long stepMillis;
    public String resolution;
    public ArrayList<JSON_ItemSeries> series = new ArrayList<>();
    /** Last display name seen in storage per requested item, for items that have one recorded. */
    public Map<String, String> names = new LinkedHashMap<>();
}
