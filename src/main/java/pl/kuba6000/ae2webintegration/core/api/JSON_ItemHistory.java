package pl.kuba6000.ae2webintegration.core.api;

import java.util.ArrayList;

/** Wire shape for {@code /itemhistory}. Built by {@code ItemHistoryStore.readSeries}. */
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
    public int limit;
    public ArrayList<JSON_ItemSeries> series = new ArrayList<>();
}
