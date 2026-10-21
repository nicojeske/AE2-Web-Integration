package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.gt.GTEnergyTunnelSnapshot;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;

class GTTunnelStoreTest {

    private static final long SECOND = TimeUnit.SECONDS.toMillis(1);
    private static final long MINUTE = TimeUnit.MINUTES.toMillis(1);
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long NOW = 20_000 * TimeUnit.DAYS.toMillis(1) + 10 * HOUR;
    private static final UUID ALICE = GTTestSupport.uuid("alice");
    private static final long IV = 8192;

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

    private static GTEnergyTunnelSnapshot tunnel(long packets, long maxed) {
        return GTTestSupport.tunnel(1, ALICE, "Main", packets * IV, packets, maxed, IV);
    }

    private static GTTunnelStore.View update(long at, long tick, GTEnergyTunnelSnapshot tunnel) {
        GTTunnelStore.update(Collections.singletonList(tunnel), at, tick);
        return GTTunnelStore.latest(tunnel.id);
    }

    @Test
    void rateIsTheCounterChangeOverTheTicksBetweenScans() {
        assertNull(update(NOW, 1000, tunnel(0, 0)).euPerTick, "one scan is not a rate");
        // 200 ticks at 16 A, then a laggy 10 s of only 100 ticks at 64 A.
        update(NOW + 10 * SECOND, 1200, tunnel(3200, 0));
        GTTunnelStore.View view = update(NOW + 20 * SECOND, 1300, tunnel(3200 + 6400, 50));

        assertEquals(9600.0 * IV / 300, view.euPerTick, 1e-6);
        assertEquals(64.0 * IV, view.peakEuPerTick, 1e-6);
        assertEquals(50.0 / 300, view.maxedShare, 1e-9);
    }

    @Test
    void aResetCounterOrAMissedScanStartsOver() {
        update(NOW, 0, tunnel(0, 0));
        update(NOW + 10 * SECOND, 200, tunnel(200, 0));
        // Reloaded part: counters back near zero. Not a negative rate, just nothing new.
        GTTunnelStore.View view = update(NOW + 20 * SECOND, 400, tunnel(10, 0));
        assertEquals(1.0 * IV, view.euPerTick, 1e-6);
        // Away for three scans' worth of ticks: the gap is dropped, the old window still counts.
        view = update(NOW + 60 * SECOND, 1000, tunnel(1_000_000, 0));
        assertEquals(1.0 * IV, view.euPerTick, 1e-6);
        view = update(NOW + 70 * SECOND, 1200, tunnel(1_000_000 + 400, 0));
        assertEquals(600.0 * IV / 400, view.euPerTick, 1e-6);
    }

    @Test
    void unlinkedTunnelsAreSkippedAndRemovedOnesStartOver() {
        GTEnergyTunnelSnapshot unlinked = tunnel(0, 0);
        unlinked.frequency = 0;
        assertNull(update(NOW, 0, unlinked), "a part not linked yet is not a tunnel");

        update(NOW, 0, tunnel(0, 0));
        update(NOW + 10 * SECOND, 200, tunnel(200, 0));
        assertTrue(GTTunnelStore.remove(tunnel(0, 0).id));
        assertNull(GTTunnelStore.latest(tunnel(0, 0).id));
        assertFalse(GTTunnelStore.remove(tunnel(0, 0).id));
        assertNull(update(NOW + 20 * SECOND, 400, tunnel(400, 0)).euPerTick, "no rate carried over");
    }

    @Test
    void theWindowForgetsIntervalsOlderThanFiveMinutes() {
        update(NOW, 0, tunnel(0, 0));
        update(NOW + 10 * SECOND, 200, tunnel(64 * 200, 0));
        long tick = 200;
        long packets = 64 * 200;
        long at = NOW + 10 * SECOND;
        GTTunnelStore.View view = null;
        for (int i = 0; i < 31; i++) {
            at += 10 * SECOND;
            tick += 200;
            packets += 200;
            view = update(at, tick, tunnel(packets, 0));
        }
        assertEquals(1.0 * IV, view.euPerTick, 1e-6);
        assertEquals(1.0 * IV, view.peakEuPerTick, 1e-6);
    }

    @Test
    void samplesAreWrittenAsAverageAndPeakPerBucket() {
        HistoryDb db = GTTestSupport.startHistory();
        long start = NOW + 5 * MINUTE;
        update(start, 0, tunnel(0, 0));
        update(start + 10 * SECOND, 200, tunnel(200 * 32, 0));
        update(start + 20 * SECOND, 400, tunnel(200 * 32 + 200 * 64, 200));
        GTTunnelStore.recordSample(start + 20 * SECOND);
        GTTestSupport.flushHistory();

        GTTunnelStore.Series series = GTTunnelStore.read(db, tunnel(0, 0).id, start, start + 20 * SECOND, 10);
        assertEquals("fine", series.resolution);
        assertEquals(48 * IV, last(series.euPerTick));
        assertEquals(64 * IV, last(series.peakEuPerTick));
        assertEquals(500, last(series.maxedPermille));
    }

    private static long last(long[] values) {
        for (int i = values.length - 1; i >= 0; i--) {
            if (values[i] != -1) return values[i];
        }
        return -1;
    }
}
