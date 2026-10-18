package pl.kuba6000.ae2webintegration.core.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.api.JSON_Bottlenecks;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb.CraftInterval;

class BottleneckAnalysisTest {

    private static final long S = TimeUnit.SECONDS.toMillis(1);
    private static final long H = TimeUnit.HOURS.toMillis(1);

    private static CraftInterval row(long job, String output, long jobStart, long jobDone, boolean cancelled,
        String machine, long start, long end) {
        return new CraftInterval(job, output, output + " name", jobStart, jobDone, cancelled, machine, start, end);
    }

    private static JSON_Bottlenecks.Machine machine(JSON_Bottlenecks result, String name) {
        return result.machines.stream()
            .filter(m -> m.name.equals(name))
            .findFirst()
            .orElseThrow(AssertionError::new);
    }

    @Test
    void queuedTimeIsWhenTwoJobsWaitOnTheSameMachine() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 10 * H, H);
        analysis.accept(row(1, "a", 0, 100 * S, false, "Furnace", 0, 100 * S));
        analysis.accept(row(2, "b", 50 * S, 200 * S, false, "Furnace", 50 * S, 200 * S));
        analysis.accept(row(3, "c", 0, 30 * S, false, "Press", 0, 30 * S));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);

        JSON_Bottlenecks.Machine furnace = result.machines.get(0);
        assertEquals("Furnace", furnace.name);
        assertEquals(200 * S, furnace.busyMillis);
        assertEquals(50 * S, furnace.queuedMillis);
        assertEquals(2, furnace.jobs);
        assertEquals(0L, machine(result, "Press").queuedMillis);
        assertEquals(3, result.jobs);
        assertEquals(3, result.completed);
    }

    @Test
    void backToBackIntervalsDoNotCountAsQueued() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, H, H);
        analysis.accept(row(1, "a", 0, 10 * S, false, "Furnace", 0, 10 * S));
        analysis.accept(row(2, "a", 10 * S, 20 * S, false, "Furnace", 10 * S, 20 * S));
        JSON_Bottlenecks.Machine furnace = analysis.result(BottleneckAnalysis.OutageCheck.NONE).machines.get(0);
        assertEquals(20 * S, furnace.busyMillis);
        assertEquals(0L, furnace.queuedMillis);
    }

    @Test
    void soleBlockerAndStarvedTimeComeFromEachJobsOwnTimeline() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, H, H);
        // Job runs 0-100s: Press alone 0-20, both 20-40, Furnace alone 40-60, nothing out 60-100.
        analysis.accept(row(1, "a", 0, 100 * S, false, "Press", 0, 40 * S));
        analysis.accept(row(1, "a", 0, 100 * S, false, "Furnace", 20 * S, 60 * S));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);

        assertEquals(20 * S, machine(result, "Press").heldMillis);
        assertEquals(20 * S, machine(result, "Furnace").heldMillis);
        JSON_Bottlenecks.Output output = result.outputs.get(0);
        assertEquals(100 * S, output.completedMillis);
        assertEquals(0.4, output.starvedShare, 1e-9);
    }

    @Test
    void intervalsClosedByACancelAreStuckNotBusy() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 20 * H, H);
        // Cancelled after 11h; the Volcanus interval was still open, the Press one had finished.
        analysis.accept(row(1, "ti", 0, 11 * H, true, "Volcanus", 60 * S, 11 * H));
        analysis.accept(row(1, "ti", 0, 11 * H, true, "Press", 0, 60 * S));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);

        JSON_Bottlenecks.Machine volcanus = machine(result, "Volcanus");
        assertEquals(0L, volcanus.busyMillis);
        assertEquals(1, volcanus.stuckAtCancel);
        assertEquals(1, volcanus.jobs);
        assertEquals(JSON_Bottlenecks.Incident.STUCK, volcanus.incidents.get(0).kind);
        assertEquals(60 * S, machine(result, "Press").busyMillis);
        assertEquals(1, result.cancelled);
        assertEquals(1, result.outputs.get(0).cancelled);
    }

    @Test
    void outliersAreClippedToTheMachinesCapOnceThereAreEnoughSamples() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 100 * H, H);
        long t = 0;
        for (int i = 0; i < BottleneckAnalysis.MIN_SAMPLES_FOR_CAP; i++, t += H) {
            analysis.accept(row(i, "a", t, t + 60 * S, false, "Furnace", t, t + 60 * S));
        }
        long outlierStart = t;
        analysis.accept(row(99, "a", t, t + 5 * H, false, "Furnace", t, t + 5 * H));
        JSON_Bottlenecks.Machine furnace = analysis.result(BottleneckAnalysis.OutageCheck.NONE).machines.get(0);

        long cap = 60 * S + BottleneckAnalysis.CAP_MIN_EXTRA_MILLIS;
        assertEquals(cap, (long) furnace.capMillis);
        assertEquals(BottleneckAnalysis.MIN_SAMPLES_FOR_CAP * 60 * S + cap, furnace.busyMillis);
        assertEquals(1, furnace.anomalies);
        assertEquals(outlierStart, furnace.incidents.get(0).started);
        assertEquals(5 * H, furnace.incidents.get(0).durationMillis);
    }

    @Test
    void aMachineWithLongAndShortRecipesKeepsItsLongOnes() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 100 * H, H);
        long t = 0;
        // 8 one-minute and 3 twenty-minute recipes: the median alone would flag every long one.
        for (int i = 0; i < 11; i++, t += H) {
            long length = i < 8 ? 60 * S : 1200 * S;
            analysis.accept(row(i, "a", t, t + length, false, "Volcanus", t, t + length));
        }
        JSON_Bottlenecks.Machine volcanus = analysis.result(BottleneckAnalysis.OutageCheck.NONE).machines.get(0);
        assertEquals(3 * 1200 * S, (long) volcanus.capMillis);
        assertEquals(0, volcanus.anomalies);
    }

    @Test
    void aClippedIntervalStillCountsAsTheJobWaitingNotStarving() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 100 * H, H);
        long t = 0;
        for (int i = 0; i < BottleneckAnalysis.MIN_SAMPLES_FOR_CAP; i++, t += H) {
            analysis.accept(row(i, "a", t, t + 60 * S, false, "Furnace", t, t + 60 * S));
        }
        analysis.accept(row(99, "b", t, t + 5 * H, false, "Furnace", t, t + 5 * H));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);
        JSON_Bottlenecks.Output b = result.outputs.stream()
            .filter(o -> o.itemid.equals("b"))
            .findFirst()
            .orElseThrow(AssertionError::new);
        assertEquals(0.0, b.starvedShare, 1e-9);
    }

    @Test
    void noCapBelowTheMinimumSamples() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 10 * H, H);
        analysis.accept(row(1, "a", 0, 60 * S, false, "Furnace", 0, 60 * S));
        analysis.accept(row(2, "a", H, 6 * H, false, "Furnace", H, 6 * H));
        JSON_Bottlenecks.Machine furnace = analysis.result(BottleneckAnalysis.OutageCheck.NONE).machines.get(0);
        assertNull(furnace.capMillis);
        assertEquals(60 * S + 5 * H, furnace.busyMillis);
        assertEquals(0, furnace.anomalies);
    }

    @Test
    void outliersDuringAPowerOutageAreLabelledAsSuch() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, 100 * H, H);
        long t = 0;
        for (int i = 0; i < BottleneckAnalysis.MIN_SAMPLES_FOR_CAP; i++, t += H) {
            analysis.accept(row(i, "a", t, t + 60 * S, false, "Furnace", t, t + 60 * S));
        }
        long outageFrom = t + H;
        analysis.accept(row(99, "a", t, t + 5 * H, false, "Furnace", t, t + 5 * H));
        JSON_Bottlenecks.Machine furnace = analysis
            .result((from, to) -> from <= outageFrom && to >= outageFrom).machines.get(0);
        assertEquals(0, furnace.anomalies);
        assertEquals(1, furnace.powerAffected);
        assertEquals(JSON_Bottlenecks.Incident.POWER, furnace.incidents.get(0).kind);
    }

    @Test
    void onlyTimeInsideTheRangeCountsAndTrendsAreBucketed() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(H, 4 * H, H);
        // 0.5h-2.5h: half an hour before the range, then 1h in bucket 1 and 0.5h in bucket 2.
        analysis.accept(row(1, "a", H / 2, 5 * H / 2, false, "Furnace", H / 2, 5 * H / 2));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);
        JSON_Bottlenecks.Machine furnace = result.machines.get(0);
        assertEquals(3 * H / 2, furnace.busyMillis);
        assertEquals(H, result.trendFrom);
        assertTrue(Arrays.equals(new long[] { H, H / 2, 0, 0 }, furnace.trendBusyMillis));
        assertEquals(3 * H / 2, result.outputs.get(0).completedMillis);
    }

    @Test
    void jobsWithoutMachineIntervalsStillCount() {
        BottleneckAnalysis analysis = new BottleneckAnalysis(0, H, H);
        analysis.accept(row(1, "a", 0, 60 * S, false, null, 0, 0));
        JSON_Bottlenecks result = analysis.result(BottleneckAnalysis.OutageCheck.NONE);
        assertEquals(1, result.jobs);
        assertTrue(result.machines.isEmpty());
        assertEquals(1.0, result.outputs.get(0).starvedShare, 1e-9);
    }
}
