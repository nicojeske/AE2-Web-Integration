package pl.kuba6000.ae2webintegration.core.server;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/** Tick-rate windows from tick start/end events, and their history. */
class ServerLoadTest {

    private static final long MS = TimeUnit.MILLISECONDS.toNanos(1);
    /** Hour-aligned, so the first window starts an hour bucket. */
    private static final long START_MILLIS = 20_352L * TimeUnit.DAYS.toMillis(1);

    private long nanos = 1_000 * MS;
    private long millis = START_MILLIS;

    @AfterEach
    void tearDown() {
        ServerLoad.reset();
        HistoryDbTestSupport.stop();
    }

    /** One tick: busy for {@code busyMs}, then idle until {@code periodMs} after the previous tick's end. */
    private void tick(long busyMs, long periodMs) {
        ServerLoad.onTickStart(nanos + (periodMs - busyMs) * MS);
        nanos += periodMs * MS;
        millis += periodMs;
        ServerLoad.onTickEnd(nanos, millis);
    }

    @Test
    void aWindowReportsTickRateTickTimeAndTheLongestTick() {
        ServerLoad.onTickEnd(nanos, millis); // starts the clock
        for (int i = 0; i < 599; i++) tick(10, 50);
        assertNull(ServerLoad.latest(), "29.95 s is not a whole window yet");
        tick(200, 200); // one lag spike closes the window

        ServerLoad.Sample sample = ServerLoad.latest();
        assertNotNull(sample);
        // 600 ticks over 29.95 s + 0.2 s.
        assertEquals(600 / 30.15, sample.tps, 0.01);
        assertEquals((599 * 10 + 200) / 600.0, sample.mspt, 0.01);
        assertEquals(200, sample.maxTickMillis);
    }

    @Test
    void withoutTickStartsThereIsNoTickTime() {
        ServerLoad.onTickEnd(nanos, millis);
        for (int i = 0; i < 600; i++) {
            nanos += 50 * MS;
            millis += 50;
            ServerLoad.onTickEnd(nanos, millis);
        }
        assertEquals(20.0, ServerLoad.latest().tps, 0.001);
        assertNull(ServerLoad.latest().mspt);
    }

    @Test
    void historyKeepsMeanRatesAndTheWorstTickPerDownsampledWindow() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        ServerLoad.onTickEnd(nanos, millis);
        for (int i = 0; i < 600; i++) tick(10, 50); // 20 TPS
        for (int i = 0; i < 300; i++) tick(100, 100); // 10 TPS
        tick(5000, 5000);
        for (int i = 0; i < 500; i++) tick(10, 50); // closes the spike's window: 501 ticks in 30 s
        HistoryDbTestSupport.flush();

        ServerLoad.Series fine = ServerLoad.read(db, START_MILLIS, START_MILLIS + 60_000, 100);
        assertEquals("fine", fine.resolution);
        assertArrayEquals(new double[] { 20.0, 10.0 }, fine.tps, 0.01);
        assertArrayEquals(new double[] { 10.0, 100.0 }, fine.mspt, 0.01);
        assertArrayEquals(new long[] { 50, 100 }, fine.maxTickMillis);

        ServerLoad.Series folded = ServerLoad.read(db, START_MILLIS, START_MILLIS + 90_000, 1);
        assertEquals(1, folded.tps.length);
        assertEquals((20.0 + 10.0 + 16.7) / 3, folded.tps[0], 0.01);
        assertEquals(5000, folded.maxTickMillis[0], "the spike survives downsampling");
        assertEquals(TimeUnit.SECONDS.toMillis(90), folded.stepMillis);
    }
}
