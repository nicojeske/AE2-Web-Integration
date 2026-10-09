package pl.kuba6000.ae2webintegration.core.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.config.Config;

class GTPassiveDetectorTest {

    private static final long HOUR = TimeUnit.HOURS.toMillis(1);
    private static final long DAY = TimeUnit.DAYS.toMillis(1);
    private static final long NOW = 20_000 * DAY + 10 * HOUR + 30 * 60_000L;
    private static final UUID ALICE = GTTestSupport.uuid("alice");

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
        GTTestSupport.startHistory();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    private static void record(String machine, String stack, long at) {
        GTProductionLog
            .record(GTFlow.PRODUCED, machine, "EBF " + machine, ALICE, stack, "Name of " + stack, 1, false, at);
    }

    /** One output of {@code stack} every hour of the last {@code hours} hours, oldest first. */
    private static void steady(String machine, String stack, int hours) {
        for (int h = hours - 1; h >= 0; h--) {
            record(machine, stack, NOW - h * HOUR);
        }
    }

    @Test
    void sameOutputsInEveryWindowAreSuggested() {
        steady("m1", "ingot", 73);
        steady("m1", "dust", 73);

        GTTestSupport.flushHistory();
        assertEquals(Collections.singleton("m1"), GTPassiveDetector.compute(NOW));
    }

    @Test
    void aNewOutputInTheLastWindowIsNotPassive() {
        steady("m1", "ingot", 73);
        record("m1", "plate", NOW - HOUR);

        GTTestSupport.flushHistory();
        assertTrue(
            GTPassiveDetector.compute(NOW)
                .isEmpty());
    }

    @Test
    void aWindowWithoutOutputIsNotPassive() {
        for (int h = 72; h >= 0; h--) {
            if (h < 24 || h >= 48) {
                record("m1", "ingot", NOW - h * HOUR);
            }
        }

        GTTestSupport.flushHistory();
        assertTrue(
            GTPassiveDetector.compute(NOW)
                .isEmpty());
    }

    @Test
    void nothingIsSuggestedBeforeADayOfTracking() {
        steady("m1", "ingot", 20);

        GTTestSupport.flushHistory();
        assertTrue(
            GTPassiveDetector.compute(NOW)
                .isEmpty());
    }

    @Test
    void aDayOfTrackingIsSplitIntoEightHourWindows() {
        // Tracking began 25h ago, so the windows are 8 hourly buckets each; m2 skipped the middle one.
        steady("m1", "ingot", 26);
        for (int h = 25; h >= 0; h--) {
            if (h < 8 || h > 15) {
                record("m2", "ingot", NOW - h * HOUR);
            }
        }

        GTTestSupport.flushHistory();
        assertEquals(Collections.singleton("m1"), GTPassiveDetector.compute(NOW));
    }

    @Test
    void candidatesAreCachedForTenMinutes() {
        steady("m1", "ingot", 73);
        GTTestSupport.flushHistory();
        assertEquals(Collections.singleton("m1"), GTPassiveDetector.candidates(NOW));

        record("m1", "plate", NOW);
        GTTestSupport.flushHistory();
        assertEquals(Collections.singleton("m1"), GTPassiveDetector.candidates(NOW + 9 * 60_000L));
        GTTestSupport.flushHistory();
        assertTrue(
            GTPassiveDetector.candidates(NOW + GTPassiveDetector.CACHE_MILLIS)
                .isEmpty());
    }
}
