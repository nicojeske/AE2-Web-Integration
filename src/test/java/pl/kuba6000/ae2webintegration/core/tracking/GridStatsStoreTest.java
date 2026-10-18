package pl.kuba6000.ae2webintegration.core.tracking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.File;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;
import pl.kuba6000.ae2webintegration.core.interfaces.GridStats;

/** Grid capacity history and its run-out forecast. */
class GridStatsStoreTest {

    private static final long MINUTE = TimeUnit.MINUTES.toMillis(1);
    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long START = 20_352L * TimeUnit.DAYS.toMillis(1);

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GridStatsStore.clear();
    }

    @AfterEach
    void tearDown() {
        GridStatsStore.clear();
        HistoryDbTestSupport.stop();
    }

    private static GridStats stats(long itemBytesUsed, long itemTypesUsed) {
        return new GridStats(itemBytesUsed, 10_000, itemTypesUsed, 630, 0, 0, 0, 0, 1234.4, 2000, 50_000, 80_000);
    }

    @Test
    void growingUsageProjectsWhenTheCellsRunOut() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        // 100 bytes an hour for 4 hours; types stay put.
        for (int m = 0; m <= 240; m++) {
            GridStatsStore.sample("g", stats(5_000 + m * 100 / 60, 300), START + m * MINUTE);
        }
        HistoryDbTestSupport.flush();

        GridStatsStore.Capacity capacity = GridStatsStore.read(db, "g", START, START + 4 * HOUR, 500);
        assertEquals("fine", capacity.resolution);
        assertEquals(5_400, capacity.current.itemBytesUsed());
        assertEquals(START + 4 * HOUR, capacity.sampledAt);
        long[] used = capacity.series.get(GridStatsStore.ITEM_BYTES_USED);
        assertEquals(5_000, used[0]);
        assertEquals(5_400, used[used.length - 1]);
        assertEquals(1234, capacity.series.get(GridStatsStore.POWER_USAGE)[0]);

        assertNotNull(capacity.itemBytesFullAt);
        // 4,600 bytes left at 100 an hour: 46 hours after the last sample, give or take the integer steps.
        assertEquals(START + 50 * HOUR, capacity.itemBytesFullAt, 30 * MINUTE);
        assertNull(capacity.itemTypesFullAt, "flat usage never runs out");
        assertNull(capacity.fluidBytesFullAt, "no fluid cells");
    }

    @Test
    void tooLittleHistoryHasNoForecast() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        for (int m = 0; m < 30; m++) GridStatsStore.sample("g", stats(5_000 + m * 10, 300), START + m * MINUTE);
        HistoryDbTestSupport.flush();

        assertNull(GridStatsStore.read(db, "g", START, START + HOUR, 500).itemBytesFullAt);
    }
}
