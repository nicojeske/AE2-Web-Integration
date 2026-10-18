package pl.kuba6000.ae2webintegration.core.api;

import java.util.ArrayList;
import java.util.List;

import org.jetbrains.annotations.Nullable;

/**
 * Wire shape for {@code GET /api/grids/{gridKey}/bottlenecks}, built by {@code BottleneckAnalysis}. A "machine"
 * is every pattern provider sharing one display name, as crafting tracking records them. All durations are in
 * milliseconds and only count time inside the requested range.
 */
public class JSON_Bottlenecks {

    /** A job interval that was left out of the time metrics or clipped. */
    public static class Incident {

        /** The job sat at this machine until it was cancelled. */
        public static final String STUCK = "stuck";
        /** Far longer than the machine's usual interval; clipped to its cap. */
        public static final String ANOMALY = "anomaly";
        /** Like {@link #ANOMALY}, but overlapping a GregTech power outage. */
        public static final String POWER = "power";

        /**
         * Crafting history entry id of the job.
         *
         * @example 12
         */
        public long jobId;
        /**
         * Final output of the job.
         *
         * @example minecraft:iron_ingot
         */
        public String itemid;
        /**
         * Display name of the final output.
         *
         * @example Iron Ingot
         */
        public String name;
        /**
         * Interval start in Unix epoch milliseconds.
         *
         * @example 1700000000000
         */
        public long started;
        /**
         * Unclipped interval length.
         *
         * @example 3600000
         */
        public long durationMillis;
        /**
         * {@code stuck}, {@code anomaly} or {@code power}.
         *
         * @example anomaly
         */
        public String kind;
    }

    /** A job output with how many of the machine's jobs produced it. */
    public static class OutputRef {

        /**
         * Registry resource identifier.
         *
         * @example minecraft:iron_ingot
         */
        public String itemid;
        /**
         * Display name.
         *
         * @example Iron Ingot
         */
        public String name;
        /**
         * Jobs with this output that used the machine.
         *
         * @example 4
         */
        public int jobs;
    }

    public static class Machine {

        /**
         * Pattern provider display name.
         *
         * @example Iron Smelter
         */
        public String name;
        /**
         * Jobs that sent work to the machine.
         *
         * @example 20
         */
        public int jobs;
        /**
         * Intervals counted (cancel-closed ones excluded).
         *
         * @example 64
         */
        public int intervals;
        /**
         * Time at least one job had work out at the machine.
         *
         * @example 7200000
         */
        public long busyMillis;
        /**
         * Time two or more jobs had work out at it at once: work queued behind the machine.
         *
         * @example 1800000
         */
        public long queuedMillis;
        /**
         * Job time spent waiting on this machine alone - the jobs' critical path ran through it. Summed over jobs,
         * so two jobs held at once count twice and it can exceed {@code busyMillis}.
         *
         * @example 3600000
         */
        public long heldMillis;
        /**
         * {@code busyMillis} over the range length, 0-1.
         *
         * @example 0.25
         */
        public double utilization;
        /**
         * Median interval length.
         *
         * @example 30000
         */
        public long p50Millis;
        /**
         * 90th percentile interval length.
         *
         * @example 120000
         */
        public long p90Millis;
        /**
         * Longest interval counted in full; null with too few intervals to tell what is unusual.
         *
         * @example 900000
         */
        public @Nullable Long capMillis;
        /**
         * Intervals clipped to the cap.
         *
         * @example 1
         */
        public int anomalies;
        /**
         * Clipped intervals that overlapped a GregTech power outage.
         *
         * @example 0
         */
        public int powerAffected;
        /**
         * Cancelled jobs that were stuck at this machine.
         *
         * @example 0
         */
        public int stuckAtCancel;
        /** Busy time per trend bucket. */
        public long[] trendBusyMillis;
        /** Queued time per trend bucket. */
        public long[] trendQueuedMillis;
        /** Outputs of the jobs using the machine, most jobs first. */
        public List<OutputRef> outputs = new ArrayList<>();
        /** The longest clipped or stuck intervals, longest first. */
        public List<Incident> incidents = new ArrayList<>();
    }

    public static class Output {

        /**
         * Registry resource identifier.
         *
         * @example minecraft:iron_ingot
         */
        public String itemid;
        /**
         * Display name.
         *
         * @example Iron Ingot
         */
        public String name;
        /**
         * Jobs with this output.
         *
         * @example 10
         */
        public int jobs;
        /**
         * How many of them were cancelled.
         *
         * @example 1
         */
        public int cancelled;
        /**
         * Median duration of the completed jobs.
         *
         * @example 60000
         */
        public long p50Millis;
        /**
         * 90th percentile duration of the completed jobs.
         *
         * @example 180000
         */
        public long p90Millis;
        /**
         * Summed duration of the completed jobs.
         *
         * @example 600000
         */
        public long completedMillis;
        /**
         * Share of completed job time with nothing out at any machine - waiting for ingredients or a CPU, 0-1.
         *
         * @example 0.1
         */
        public double starvedShare;
        /**
         * Machine that was most often the only one these jobs waited on; null when none was.
         *
         * @example Iron Smelter
         */
        public @Nullable String topBlocker;
        /**
         * Job time {@code topBlocker} held these jobs up alone.
         *
         * @example 300000
         */
        public long topBlockerMillis;
    }

    /**
     * Range start in Unix epoch milliseconds.
     *
     * @example 1700000000000
     */
    public long from;
    /**
     * Range end in Unix epoch milliseconds.
     *
     * @example 1700604800000
     */
    public long to;
    /**
     * Start of the first trend bucket, in Unix epoch milliseconds.
     *
     * @example 1699920000000
     */
    public long trendFrom;
    /**
     * Width of one trend bucket.
     *
     * @example 86400000
     */
    public long bucketMillis;
    /**
     * Jobs overlapping the range.
     *
     * @example 120
     */
    public int jobs;
    /**
     * How many of them completed.
     *
     * @example 115
     */
    public int completed;
    /**
     * How many of them were cancelled.
     *
     * @example 5
     */
    public int cancelled;
    /**
     * Whether GregTech machine status history was available to tell power outages apart.
     *
     * @example true
     */
    public boolean powerData;
    /** Machines, most held job time first. */
    public List<Machine> machines = new ArrayList<>();
    /** Job outputs, most job time first. */
    public List<Output> outputs = new ArrayList<>();
    /**
     * Crafting plans in the range that came back with missing ingredients (web and auto-stock).
     *
     * @example 6
     */
    public int failedPlans;
    /** Ingredients those plans were missing, most often missing first. */
    public List<MissingIngredient> missingIngredients = new ArrayList<>();

    /** An ingredient crafting plans were missing. */
    public static class MissingIngredient {

        /**
         * Registry resource identifier.
         *
         * @example gregtech:gt.metaitem.01:11305
         */
        public String itemid;
        /**
         * Display name.
         *
         * @example Steel Ingot
         */
        public String name;
        /**
         * Failed plans it was missing from.
         *
         * @example 3
         */
        public int plans;
        /**
         * Units missing, summed over those plans.
         *
         * @example 2048
         */
        public long amount;
        /**
         * When it was last missing, in Unix epoch milliseconds.
         *
         * @example 1700600000000
         */
        public long lastSeen;
        /** Display names of the outputs it blocked most often, up to three. */
        public List<String> blockedOutputs = new ArrayList<>();
    }
}
