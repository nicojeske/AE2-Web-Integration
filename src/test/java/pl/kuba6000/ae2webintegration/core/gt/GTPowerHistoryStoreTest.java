package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.File;
import java.math.BigInteger;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;

class GTPowerHistoryStoreTest {

    private static final long SECOND = 1000L;
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long NOW = 1_000_000 * HOUR;
    private static final UUID TEAM = GTTestSupport.uuid("team");

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    @Test
    void netUsesReportedAveragesWhenPresent() {
        GTPowerSourceSnapshot lsc = GTTestSupport.lsc(1, TEAM, 100, 1000, 50L, 80L);
        GTPowerHistoryStore.updateLatest(Collections.singletonList(lsc), NOW);

        assertEquals(-30L, GTPowerHistoryStore.netPerTick(lsc));
    }

    @Test
    void netFallsBackToStoredDeltaOverRecentSamples() {
        GTPowerSourceSnapshot first = GTTestSupport.wireless(TEAM, BigInteger.valueOf(1_000_000));
        GTPowerHistoryStore.updateLatest(Collections.singletonList(first), NOW);
        assertNull(GTPowerHistoryStore.netPerTick(first), "one sample is not a rate");

        // +200,000 EU over 10 s = 200 ticks -> 1000 EU/t.
        GTPowerSourceSnapshot second = GTTestSupport.wireless(TEAM, BigInteger.valueOf(1_200_000));
        GTPowerHistoryStore.updateLatest(Collections.singletonList(second), NOW + 10 * SECOND);

        assertEquals(1000L, GTPowerHistoryStore.netPerTick(second));
    }

    @Test
    void rateWindowDropsSamplesOlderThanFiveMinutes() {
        GTPowerSourceSnapshot old = GTTestSupport.wireless(TEAM, BigInteger.ZERO);
        GTPowerHistoryStore.updateLatest(Collections.singletonList(old), NOW);
        GTPowerSourceSnapshot mid = GTTestSupport.wireless(TEAM, BigInteger.valueOf(1_000_000));
        GTPowerHistoryStore.updateLatest(Collections.singletonList(mid), NOW + 10 * 60 * SECOND);
        GTPowerSourceSnapshot last = GTTestSupport.wireless(TEAM, BigInteger.valueOf(1_000_000 + 20 * 50));
        GTPowerHistoryStore.updateLatest(Collections.singletonList(last), NOW + 10 * 60 * SECOND + 50 * 20);

        // Only mid -> last is in the window: 1000 EU over 20 ticks.
        assertEquals(50L, GTPowerHistoryStore.netPerTick(last));
    }

    @Test
    void readDownsamplesWithNewestValuePerWindowAndMarksGaps() {
        HistoryDb db = GTTestSupport.startHistory();
        for (int i = 0; i < 4; i++) {
            GTPowerSourceSnapshot lsc = GTTestSupport.lsc(1, TEAM, 100 + i, 1000, 5L, 6L);
            GTPowerHistoryStore.recordSample(Collections.singletonList(lsc), NOW + i * 30 * SECOND);
        }
        String id = GTPowerSourceSnapshot.lscId(0, 1, 64, 0);
        GTTestSupport.flushHistory();

        GTPowerHistoryStore.Series series = GTPowerHistoryStore.read(db, id, NOW, NOW + 150 * SECOND, 120);

        assertEquals("fine", series.resolution);
        assertArrayEquals(new long[] { 100, 101, 102, 103, -1, -1 }, series.stored);
        assertArrayEquals(new long[] { 5, 5, 5, 5, -1, -1 }, series.avgIn);

        GTPowerHistoryStore.Series coarse = GTPowerHistoryStore.read(db, id, NOW, NOW + 150 * SECOND, 3);
        assertArrayEquals(new long[] { 101, 103, -1 }, coarse.stored);
    }

    @Test
    void longRangesReadTheHourlyTier() {
        HistoryDb db = GTTestSupport.startHistory();
        GTPowerSourceSnapshot lsc = GTTestSupport.lsc(1, TEAM, 7, 1000, null, null);
        GTPowerHistoryStore.recordSample(Collections.singletonList(lsc), NOW);
        GTTestSupport.flushHistory();

        GTPowerHistoryStore.Series series = GTPowerHistoryStore.read(db, lsc.id, NOW - 48 * HOUR, NOW, 500);

        assertEquals("hourly", series.resolution);
        assertEquals(7, series.stored[series.stored.length - 1]);
        assertEquals(-1, series.avgIn[series.avgIn.length - 1], "no averages reported, no samples");
    }

    @Test
    void hugeValuesSaturateInHistory() {
        BigInteger huge = BigInteger.valueOf(Long.MAX_VALUE)
            .multiply(BigInteger.TEN);
        assertEquals(Long.MAX_VALUE, GTPowerHistoryStore.saturate(huge));
        assertEquals(5L, GTPowerHistoryStore.saturate(BigInteger.valueOf(5)));
    }

    @Test
    void aRestartKeepsHistoryButNotLatest() {
        GTTestSupport.startHistory();
        GTPowerSourceSnapshot lsc = GTTestSupport.lsc(1, TEAM, 77, 1000, 1L, 2L);
        GTPowerHistoryStore.updateLatest(Collections.singletonList(lsc), NOW);
        GTPowerHistoryStore.recordSample(Collections.singletonList(lsc), NOW);
        GTTestSupport.flushHistory();
        GTPowerHistoryStore.clear();

        HistoryDb db = HistoryDbTestSupport.restart(HistoryDbTestSupport.Flavor.TIMESCALE);

        assertNull(GTPowerHistoryStore.latest(lsc.id), "current state comes from the next scan");
        GTPowerHistoryStore.Series series = GTPowerHistoryStore.read(db, lsc.id, NOW, NOW, 10);
        assertEquals(77, series.stored[0]);
    }
}
