package pl.kuba6000.ae2webintegration.core.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Random;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/**
 * "Track every item" sizing: one grid with 30,000 items sampled every 5 minutes for a day, about 5% of them
 * changing per sample. Slow, so opt-in: {@code AE2WEB_SCALE_TEST=1 ./gradlew test --tests '*ScaleTest'}.
 */
@EnabledIfEnvironmentVariable(named = "AE2WEB_SCALE_TEST", matches = "1")
class HistoryDbScaleTest {

    private static final int ITEMS = 30_000;
    private static final long FINE = TimeUnit.MINUTES.toMillis(5);
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final int SAMPLES = (int) (TimeUnit.DAYS.toMillis(1) / FINE);
    private static final long START = 20_352 * TimeUnit.DAYS.toMillis(1);

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
    }

    @Test
    void oneDayOfThirtyThousandItems() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.TIMESCALE);
        Random random = new Random(42);
        long[] values = new long[ITEMS];
        String[] keys = new String[ITEMS];
        for (int i = 0; i < ITEMS; i++) {
            keys[i] = "mod:item_" + i;
            values[i] = random.nextInt(1_000_000);
        }

        long worstPassNanos = 0;
        long totalPassNanos = 0;
        long started = System.nanoTime();
        for (int sample = 0; sample < SAMPLES; sample++) {
            long fineStart = START + sample * FINE;
            long hourlyStart = Math.floorDiv(fineStart, HOUR) * HOUR;
            long passStarted = System.nanoTime();
            for (int i = 0; i < ITEMS; i++) {
                if (random.nextInt(20) == 0) {
                    values[i] += random.nextInt(2001) - 1000;
                }
                db.putGauge(HistoryTable.ITEM_FINE, "grid", keys[i], fineStart, values[i]);
                db.putGauge(HistoryTable.ITEM_HOURLY, "grid", keys[i], hourlyStart, values[i]);
            }
            db.markSampled(HistoryTable.ITEM_FINE, "grid", fineStart, FINE);
            db.markSampled(HistoryTable.ITEM_HOURLY, "grid", hourlyStart, HOUR);
            long passNanos = System.nanoTime() - passStarted;
            worstPassNanos = Math.max(worstPassNanos, passNanos);
            totalPassNanos += passNanos;
            // Like the real sampler, passes are minutes apart: let the writer keep up instead of only queueing.
            assertTrue(db.flush(TimeUnit.MINUTES.toMillis(2)), "writer fell behind");
        }
        long wallMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

        long fineRows = HistoryDbTestSupport.rowCount(Flavor.TIMESCALE, HistoryTable.ITEM_FINE);
        long hourlyRows = HistoryDbTestSupport.rowCount(Flavor.TIMESCALE, HistoryTable.ITEM_HOURLY);
        long uncompressed = HistoryDbTestSupport
            .queryLong(Flavor.TIMESCALE, "SELECT hypertable_size('ae2wi_item_fine')");
        HistoryDbTestSupport.queryLong(
            Flavor.TIMESCALE,
            "SELECT count(compress_chunk(c, if_not_compressed => true)) FROM show_chunks('ae2wi_item_fine') c");
        long compressed = HistoryDbTestSupport.queryLong(Flavor.TIMESCALE, "SELECT hypertable_size('ae2wi_item_fine')");

        long readStarted = System.nanoTime();
        long[] series = db
            .readGauge(HistoryTable.ITEM_FINE, "grid", keys[123], START / FINE, START / FINE + SAMPLES - 1, 1, FINE);
        long readMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - readStarted);

        System.out.printf(
            "scale: %d samples x %d items in %d s; enqueue per pass avg %d ms, worst %d ms%n"
                + "scale: fine rows %d, hourly rows %d; item_fine %d MB uncompressed, %d MB compressed%n"
                + "scale: one-day single-item read %d ms%n",
            SAMPLES,
            ITEMS,
            wallMillis / 1000,
            TimeUnit.NANOSECONDS.toMillis(totalPassNanos / SAMPLES),
            TimeUnit.NANOSECONDS.toMillis(worstPassNanos),
            fineRows,
            hourlyRows,
            uncompressed >> 20,
            compressed >> 20,
            readMillis);

        assertEquals(SAMPLES, series.length);
        assertEquals(values[123], series[SAMPLES - 1]);
        assertTrue(fineRows < (long) ITEMS * SAMPLES / 5, "change-only storage must stay far below one row per sample");
    }
}
