package pl.kuba6000.ae2webintegration.core.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;

/** Finished crafting jobs in the history database: write, page, filter, read back the detail, prune. */
class CraftJobHistoryTest {

    private static final long DAY = TimeUnit.DAYS.toMillis(1);
    private static final long NOW = 20_352 * DAY;

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
    }

    private static void job(HistoryDb db, String grid, String itemid, long done, boolean cancelled) {
        db.putCraftJob(
            grid,
            itemid,
            "Name of " + itemid,
            64,
            null,
            done - 60_000,
            done,
            cancelled,
            "Steve",
            "{\"finalOutput\":{\"itemid\":\"" + itemid + "\"},\"items\":[]}");
    }

    @Test
    void jobsPageNewestFirstAndFilterByOutput() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        job(db, "g", "iron", NOW - 3000, false);
        job(db, "g", "gold", NOW - 2000, true);
        job(db, "g", "iron", NOW - 1000, false);
        job(db, "other", "iron", NOW, false);
        HistoryDbTestSupport.flush();

        List<HistoryDb.CraftJob> page = db.readCraftJobs("g", null, Long.MAX_VALUE, 2);
        assertEquals(2, page.size());
        assertEquals(NOW - 1000, page.get(0).done);
        assertEquals(NOW - 2000, page.get(1).done);
        assertTrue(page.get(1).cancelled);
        assertEquals("Steve", page.get(0).requestedBy);
        assertEquals(60_000, page.get(0).done - page.get(0).started);

        List<HistoryDb.CraftJob> older = db.readCraftJobs("g", null, page.get(1).done, 2);
        assertEquals(1, older.size());
        assertEquals(NOW - 3000, older.get(0).done);

        List<HistoryDb.CraftJob> iron = db.readCraftJobs("g", "iron", Long.MAX_VALUE, 10);
        assertEquals(2, iron.size());
        assertFalse(
            iron.stream()
                .anyMatch(j -> !j.outputItemid.equals("iron")));
    }

    @Test
    void theDetailIsReadBackOnlyOnItsOwnGrid() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        job(db, "g", "iron", NOW, false);
        HistoryDbTestSupport.flush();
        long id = db.readCraftJobs("g", null, Long.MAX_VALUE, 1)
            .get(0).id;

        JsonObject detail = new JsonParser().parse(db.readCraftJobDetail("g", id))
            .getAsJsonObject();
        assertEquals(
            "iron",
            detail.getAsJsonObject("finalOutput")
                .get("itemid")
                .getAsString());
        assertNull(db.readCraftJobDetail("other", id));
    }

    @Test
    void pruningDropsJobsFinishedBeforeTheCutoff() {
        HistoryDb db = HistoryDbTestSupport.start(Flavor.POSTGRES);
        job(db, "g", "iron", NOW - 10 * DAY, false);
        job(db, "g", "iron", NOW - DAY, false);
        db.pruneCraftJobs(NOW - 5 * DAY, NOW);
        HistoryDbTestSupport.flush();

        List<HistoryDb.CraftJob> left = db.readCraftJobs("g", null, Long.MAX_VALUE, 10);
        assertEquals(1, left.size());
        assertEquals(NOW - DAY, left.get(0).done);
    }

    @Test
    void anUnreachableDatabaseReadsAsNoHistory() {
        HistoryDb db = HistoryDbTestSupport.startUnreachable();
        assertTrue(
            db.readCraftJobs("g", null, Long.MAX_VALUE, 10)
                .isEmpty());
        assertNull(db.readCraftJobDetail("g", 1));
    }
}
