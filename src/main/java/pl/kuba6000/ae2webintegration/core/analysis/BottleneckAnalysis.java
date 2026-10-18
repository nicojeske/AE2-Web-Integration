package pl.kuba6000.ae2webintegration.core.analysis;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import pl.kuba6000.ae2webintegration.core.api.JSON_Bottlenecks;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb.CraftInterval;

/**
 * Finds the machines crafting jobs wait on, from the per-machine intervals of finished jobs
 * ({@link CraftInterval}). Pure computation: feed it rows with {@link #accept}, then call {@link #result} once.
 * <p>
 * Robustness, since a single stuck job or power cut would otherwise dominate every ranking:
 * <ul>
 * <li>A cancelled job closes its still-open intervals at the cancel time ({@code AE2JobTracker.completeCrafting}),
 * so those say how long someone waited before giving up, not how long the machine worked. They are left out of
 * every time metric and counted once as {@code stuckAtCancel} on the machine that had been out longest.</li>
 * <li>A machine with at least {@link #MIN_SAMPLES_FOR_CAP} intervals has every interval longer than
 * {@code max(10 x median, 3 x p90, median + 10 min)} clipped to that cap and listed as an incident - flagged as a
 * power problem when it overlaps a known GregTech power outage. The p90 term keeps a machine that runs both
 * short and long recipes from flagging every long one. Clipping only affects the machine metrics; a job still
 * counts as waiting on a machine for the whole interval, so it is not reported as starved.</li>
 * </ul>
 */
public final class BottleneckAnalysis implements Consumer<CraftInterval> {

    static final int MIN_SAMPLES_FOR_CAP = 10;
    static final long CAP_MEDIAN_FACTOR = 10;
    static final long CAP_P90_FACTOR = 3;
    static final long CAP_MIN_EXTRA_MILLIS = TimeUnit.MINUTES.toMillis(10);
    static final int MAX_MACHINES = 100;
    static final int MAX_OUTPUTS = 100;
    static final int MAX_INCIDENTS = 10;
    static final int MAX_MACHINE_OUTPUTS = 5;

    /** Whether {@code [fromMillis, toMillis]} overlaps a power outage. */
    public interface OutageCheck {

        OutageCheck NONE = (fromMillis, toMillis) -> false;

        boolean overlaps(long fromMillis, long toMillis);
    }

    private static final class Interval {

        final String machine;
        final long started;
        final long ended;
        /** {@link #ended}, or earlier when clipped to the machine's cap. */
        long effectiveEnd;
        boolean openAtCancel;

        Interval(String machine, long started, long ended) {
            this.machine = machine;
            this.started = started;
            this.ended = ended;
            this.effectiveEnd = ended;
        }
    }

    private static final class Job {

        final long id;
        final String outputItemid;
        final String outputName;
        final long started;
        final long done;
        final boolean cancelled;
        final List<Interval> intervals = new ArrayList<>();

        Job(CraftInterval row) {
            id = row.jobId;
            outputItemid = row.outputItemid;
            outputName = row.outputName;
            started = row.jobStarted;
            done = row.jobDone;
            cancelled = row.cancelled;
        }
    }

    private static final class MachineStats {

        final String name;
        final List<Long> durations = new ArrayList<>();
        final List<long[]> events = new ArrayList<>();
        final Map<String, int[]> outputJobs = new HashMap<>();
        final Map<String, String> outputNames = new HashMap<>();
        final List<JSON_Bottlenecks.Incident> incidents = new ArrayList<>();
        int jobs;
        int intervals;
        long capMillis = Long.MAX_VALUE;
        long heldMillis;
        int anomalies;
        int powerAffected;
        int stuckAtCancel;

        MachineStats(String name) {
            this.name = name;
        }
    }

    private static final class OutputStats {

        final String itemid;
        final String name;
        int jobs;
        int cancelled;
        final List<Long> durations = new ArrayList<>();
        long completedMillis;
        long starvedMillis;
        final Map<String, long[]> blockers = new HashMap<>();

        OutputStats(String itemid, String name) {
            this.itemid = itemid;
            this.name = name;
        }
    }

    private final long fromMillis;
    private final long toMillis;
    private final long bucketMillis;
    private final long firstBucket;
    private final int bucketCount;
    private final Map<Long, Job> jobs = new LinkedHashMap<>();
    /** Machine names repeat across thousands of rows; one instance each. */
    private final Map<String, String> names = new HashMap<>();

    public BottleneckAnalysis(long fromMillis, long toMillis, long bucketMillis) {
        this.fromMillis = fromMillis;
        this.toMillis = Math.max(fromMillis, toMillis);
        this.bucketMillis = bucketMillis;
        this.firstBucket = Math.floorDiv(fromMillis, bucketMillis);
        this.bucketCount = (int) (Math.floorDiv(this.toMillis, bucketMillis) - firstBucket + 1);
    }

    @Override
    public void accept(CraftInterval row) {
        Job job = jobs.get(row.jobId);
        if (job == null) {
            job = new Job(row);
            jobs.put(row.jobId, job);
        }
        if (row.machine != null && row.ended > row.started) {
            String machine = names.computeIfAbsent(row.machine, k -> k);
            job.intervals.add(new Interval(machine, row.started, row.ended));
        }
    }

    public JSON_Bottlenecks result(OutageCheck outages) {
        Map<String, MachineStats> machines = new HashMap<>();
        Map<String, OutputStats> outputs = new HashMap<>();

        // 1. Leave out what a cancel closed, and collect each machine's interval durations.
        for (Job job : jobs.values()) {
            Interval longestOpen = null;
            for (Interval interval : job.intervals) {
                MachineStats machine = machines.computeIfAbsent(interval.machine, MachineStats::new);
                if (job.cancelled && interval.ended >= job.done) {
                    interval.openAtCancel = true;
                    if (longestOpen == null || interval.started < longestOpen.started) longestOpen = interval;
                    continue;
                }
                machine.durations.add(interval.ended - interval.started);
            }
            if (longestOpen != null) {
                MachineStats machine = machines.get(longestOpen.machine);
                machine.stuckAtCancel++;
                addIncident(machine, job, longestOpen, JSON_Bottlenecks.Incident.STUCK);
            }
        }

        // 2. Per-machine cap, from the median.
        for (MachineStats machine : machines.values()) {
            if (machine.durations.size() < MIN_SAMPLES_FOR_CAP) continue;
            long median = percentile(machine.durations, 0.5);
            long p90 = percentile(machine.durations, 0.9);
            machine.capMillis = Math
                .max(Math.max(CAP_MEDIAN_FACTOR * median, CAP_P90_FACTOR * p90), median + CAP_MIN_EXTRA_MILLIS);
        }

        // 3. Clip, collect machine events, and per-job critical path.
        for (Job job : jobs.values()) {
            OutputStats output = outputs
                .computeIfAbsent(job.outputItemid, k -> new OutputStats(job.outputItemid, job.outputName));
            output.jobs++;
            if (job.cancelled) output.cancelled++;
            else output.durations.add(job.done - job.started);

            List<long[]> jobEvents = new ArrayList<>();
            List<long[]> rawSpans = new ArrayList<>();
            List<String> jobMachines = new ArrayList<>();
            Map<String, Boolean> seen = new HashMap<>();
            for (Interval interval : job.intervals) {
                MachineStats machine = machines.get(interval.machine);
                if (seen.put(interval.machine, Boolean.TRUE) == null) {
                    machine.jobs++;
                    machine.outputJobs.computeIfAbsent(job.outputItemid, k -> new int[1])[0]++;
                    machine.outputNames.putIfAbsent(job.outputItemid, job.outputName);
                }
                if (interval.openAtCancel) continue;
                machine.intervals++;
                long duration = interval.ended - interval.started;
                if (duration > machine.capMillis) {
                    interval.effectiveEnd = interval.started + machine.capMillis;
                    boolean power = outages.overlaps(interval.started, interval.ended);
                    if (power) machine.powerAffected++;
                    else machine.anomalies++;
                    addIncident(
                        machine,
                        job,
                        interval,
                        power ? JSON_Bottlenecks.Incident.POWER : JSON_Bottlenecks.Incident.ANOMALY);
                }
                long start = Math.max(interval.started, fromMillis);
                long rawEnd = Math.min(interval.ended, toMillis);
                if (rawEnd > start) rawSpans.add(new long[] { start, rawEnd });
                long end = Math.min(interval.effectiveEnd, toMillis);
                if (end <= start) continue;
                machine.events.add(new long[] { start, 1 });
                machine.events.add(new long[] { end, -1 });
                int index = jobMachines.size();
                jobMachines.add(interval.machine);
                jobEvents.add(new long[] { start, 1, index });
                jobEvents.add(new long[] { end, -1, index });
            }
            sweepJob(jobEvents, jobMachines, machines, output);
            if (!job.cancelled) {
                long covered = unionLength(rawSpans);
                long span = Math.min(job.done, toMillis) - Math.max(job.started, fromMillis);
                if (span > 0) {
                    output.completedMillis += span;
                    output.starvedMillis += Math.max(0L, span - covered);
                }
            }
        }

        // 4. Busy and queued time per machine.
        JSON_Bottlenecks result = new JSON_Bottlenecks();
        result.from = fromMillis;
        result.to = toMillis;
        result.trendFrom = firstBucket * bucketMillis;
        result.bucketMillis = bucketMillis;
        result.jobs = jobs.size();
        long windowMillis = Math.max(1L, toMillis - fromMillis);
        List<JSON_Bottlenecks.Machine> machineRows = new ArrayList<>();
        for (MachineStats stats : machines.values()) {
            JSON_Bottlenecks.Machine row = new JSON_Bottlenecks.Machine();
            row.name = stats.name;
            row.jobs = stats.jobs;
            row.intervals = stats.intervals;
            row.trendBusyMillis = new long[bucketCount];
            row.trendQueuedMillis = new long[bucketCount];
            sweepMachine(stats.events, row);
            row.utilization = Math.min(1d, row.busyMillis / (double) windowMillis);
            row.heldMillis = stats.heldMillis;
            row.p50Millis = percentile(stats.durations, 0.5);
            row.p90Millis = percentile(stats.durations, 0.9);
            row.capMillis = stats.capMillis == Long.MAX_VALUE ? null : stats.capMillis;
            row.anomalies = stats.anomalies;
            row.powerAffected = stats.powerAffected;
            row.stuckAtCancel = stats.stuckAtCancel;
            stats.incidents.sort(
                Comparator.comparingLong((JSON_Bottlenecks.Incident i) -> i.durationMillis)
                    .reversed());
            row.incidents = new ArrayList<>(
                stats.incidents.subList(0, Math.min(MAX_INCIDENTS, stats.incidents.size())));
            List<Map.Entry<String, int[]>> top = new ArrayList<>(stats.outputJobs.entrySet());
            top.sort((a, b) -> Integer.compare(b.getValue()[0], a.getValue()[0]));
            for (Map.Entry<String, int[]> entry : top.subList(0, Math.min(MAX_MACHINE_OUTPUTS, top.size()))) {
                JSON_Bottlenecks.OutputRef ref = new JSON_Bottlenecks.OutputRef();
                ref.itemid = entry.getKey();
                ref.name = stats.outputNames.get(entry.getKey());
                ref.jobs = entry.getValue()[0];
                row.outputs.add(ref);
            }
            machineRows.add(row);
        }
        machineRows.sort(
            Comparator.comparingLong((JSON_Bottlenecks.Machine m) -> m.heldMillis)
                .thenComparingLong(m -> m.queuedMillis)
                .thenComparingLong(m -> m.busyMillis)
                .reversed()
                .thenComparing(m -> m.name));
        result.machines = new ArrayList<>(machineRows.subList(0, Math.min(MAX_MACHINES, machineRows.size())));

        // 5. Per output.
        List<JSON_Bottlenecks.Output> outputRows = new ArrayList<>();
        for (OutputStats stats : outputs.values()) {
            JSON_Bottlenecks.Output row = new JSON_Bottlenecks.Output();
            row.itemid = stats.itemid;
            row.name = stats.name;
            row.jobs = stats.jobs;
            row.cancelled = stats.cancelled;
            row.p50Millis = percentile(stats.durations, 0.5);
            row.p90Millis = percentile(stats.durations, 0.9);
            row.completedMillis = stats.completedMillis;
            row.starvedShare = stats.completedMillis > 0 ? stats.starvedMillis / (double) stats.completedMillis : 0d;
            String topMachine = null;
            long topMillis = 0L;
            for (Map.Entry<String, long[]> entry : stats.blockers.entrySet()) {
                if (entry.getValue()[0] > topMillis) {
                    topMillis = entry.getValue()[0];
                    topMachine = entry.getKey();
                }
            }
            row.topBlocker = topMachine;
            row.topBlockerMillis = topMillis;
            result.completed += stats.jobs - stats.cancelled;
            result.cancelled += stats.cancelled;
            outputRows.add(row);
        }
        outputRows.sort(
            Comparator.comparingLong((JSON_Bottlenecks.Output o) -> o.completedMillis)
                .reversed()
                .thenComparing(o -> o.itemid));
        result.outputs = new ArrayList<>(outputRows.subList(0, Math.min(MAX_OUTPUTS, outputRows.size())));
        return result;
    }

    /** One job's machine events: credits each stretch where exactly one machine had work out to that machine. */
    private static void sweepJob(List<long[]> events, List<String> machineOf, Map<String, MachineStats> machines,
        OutputStats output) {
        if (events.isEmpty()) return;
        sortEvents(events);
        int[] activeCount = new int[machineOf.size()];
        int active = 0;
        long previous = events.get(0)[0];
        for (long[] event : events) {
            long elapsed = event[0] - previous;
            if (elapsed > 0) {
                if (active == 1) {
                    String sole = null;
                    for (int i = 0; i < activeCount.length; i++) {
                        if (activeCount[i] > 0) {
                            sole = machineOf.get(i);
                            break;
                        }
                    }
                    machines.get(sole).heldMillis += elapsed;
                    output.blockers.computeIfAbsent(sole, k -> new long[1])[0] += elapsed;
                }
            }
            previous = event[0];
            activeCount[(int) event[2]] += (int) event[1];
            active += (int) event[1];
        }
    }

    /** Total length covered by {@code spans} ({start, end} pairs), overlaps counted once. */
    private static long unionLength(List<long[]> spans) {
        spans.sort((a, b) -> Long.compare(a[0], b[0]));
        long total = 0L;
        long coveredUntil = Long.MIN_VALUE;
        for (long[] span : spans) {
            long start = Math.max(span[0], coveredUntil);
            if (span[1] > start) {
                total += span[1] - start;
                coveredUntil = span[1];
            }
        }
        return total;
    }

    /** Busy (at least one job out) and queued (two or more) time, in total and per trend bucket. */
    private void sweepMachine(List<long[]> events, JSON_Bottlenecks.Machine row) {
        if (events.isEmpty()) return;
        sortEvents(events);
        int active = 0;
        long previous = events.get(0)[0];
        for (long[] event : events) {
            if (event[0] > previous) {
                if (active >= 1) {
                    row.busyMillis += event[0] - previous;
                    addToBuckets(row.trendBusyMillis, previous, event[0]);
                }
                if (active >= 2) {
                    row.queuedMillis += event[0] - previous;
                    addToBuckets(row.trendQueuedMillis, previous, event[0]);
                }
            }
            previous = event[0];
            active += (int) event[1];
        }
    }

    /** By time; at equal times an end sorts before a start, so back-to-back intervals never overlap. */
    private static void sortEvents(List<long[]> events) {
        events.sort((a, b) -> a[0] != b[0] ? Long.compare(a[0], b[0]) : Long.compare(a[1], b[1]));
    }

    private void addToBuckets(long[] buckets, long start, long end) {
        long bucket = Math.floorDiv(start, bucketMillis);
        while (start < end) {
            long bucketEnd = (bucket + 1) * bucketMillis;
            long sliceEnd = Math.min(end, bucketEnd);
            int index = (int) (bucket - firstBucket);
            if (index >= 0 && index < buckets.length) buckets[index] += sliceEnd - start;
            start = sliceEnd;
            bucket++;
        }
    }

    private static void addIncident(MachineStats machine, Job job, Interval interval, String kind) {
        JSON_Bottlenecks.Incident incident = new JSON_Bottlenecks.Incident();
        incident.jobId = job.id;
        incident.itemid = job.outputItemid;
        incident.name = job.outputName;
        incident.started = interval.started;
        incident.durationMillis = interval.ended - interval.started;
        incident.kind = kind;
        machine.incidents.add(incident);
    }

    /** Nearest-rank percentile; 0 for no values. */
    static long percentile(List<Long> values, double fraction) {
        if (values.isEmpty()) return 0L;
        long[] sorted = new long[values.size()];
        for (int i = 0; i < sorted.length; i++) sorted[i] = values.get(i);
        Arrays.sort(sorted);
        int index = (int) Math.ceil(fraction * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    }
}
