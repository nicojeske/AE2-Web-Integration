package pl.kuba6000.ae2webintegration.core.history;

import java.util.concurrent.TimeUnit;

/**
 * The sample tables of the history database. Each is a hypertable when TimescaleDB is installed, which is
 * also why they are split by data family and tier rather than one table with a {@code tier} column: every
 * family has its own retention, and dropping whole chunks per table is what keeps retention cheap.
 */
public enum HistoryTable {

    /** Item stored counts at the statistics sample interval; a row only when the value changes. */
    ITEM_FINE("item_fine", Kind.CHANGE_GAUGE, TimeUnit.DAYS.toMillis(1), TimeUnit.HOURS.toMillis(6)),
    /** Item stored counts, last sample of each hour; a row only when the value changes. */
    ITEM_HOURLY("item_hourly", Kind.CHANGE_GAUGE, TimeUnit.DAYS.toMillis(7), TimeUnit.DAYS.toMillis(1)),
    /** GregTech power sources at the power sample interval, one row per sample. */
    POWER_FINE("power_fine", Kind.GAUGE, TimeUnit.DAYS.toMillis(1), 0L),
    POWER_HOURLY("power_hourly", Kind.GAUGE, TimeUnit.DAYS.toMillis(7), 0L),
    /** GregTech production, summed per hour. */
    PRODUCTION_HOURLY("production_hourly", Kind.COUNTER, TimeUnit.DAYS.toMillis(7), 0L),
    PRODUCTION_DAILY("production_daily", Kind.COUNTER, TimeUnit.DAYS.toMillis(30), 0L);

    public enum Kind {
        /**
         * Gauge stored as changes only. Whether a bucket was sampled at all comes from the coverage table,
         * so "unchanged" and "server was offline" stay distinguishable.
         */
        CHANGE_GAUGE,
        /** Gauge with one row per sample; a missing row is a gap. */
        GAUGE,
        /** Additive bucket totals. */
        COUNTER
    }

    /** Short name, also stored in {@code ae2wi_series.tbl}. */
    final String id;
    final Kind kind;
    final long chunkMillis;
    /**
     * For {@link Kind#CHANGE_GAUGE}: an unchanged value is still rewritten once this much time has passed,
     * so retention never deletes the only row a later reading carries forward from.
     */
    final long anchorMillis;

    HistoryTable(String id, Kind kind, long chunkMillis, long anchorMillis) {
        this.id = id;
        this.kind = kind;
        this.chunkMillis = chunkMillis;
        this.anchorMillis = anchorMillis;
    }

    /** See {@link #anchorMillis}; 0 for tables that are not change-only. */
    public long anchorMillis() {
        return anchorMillis;
    }

    String sqlName() {
        return "ae2wi_" + id;
    }
}
