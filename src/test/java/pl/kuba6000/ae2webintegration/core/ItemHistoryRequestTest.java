package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.ae2request.async.GetItemHistory;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.ae2request.async.TrackedItems;
import pl.kuba6000.ae2webintegration.core.config.ConfigBootstrap;

/**
 * {@code /itemhistory} and {@code /trackeditems} at the request-handler level, exercised the same way
 * {@code AsyncRequestAuthorizationTest} exercises other async endpoints - through {@code IAsyncRequest}
 * directly, no HTTP server involved.
 */
class ItemHistoryRequestTest {

    private static final long MY_GRID = 30L;
    private static final WebPrincipal ME = TestGridFixtures.principal(43);

    @BeforeEach
    void setUp() {
        GridAccessSessions.clear();
        AE2Controller.AE2Interface = TestGridFixtures.ae();
        ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue = () -> 2;
    }

    @AfterEach
    void resetConfig() {
        ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue = () -> 24;
    }

    private static void grantAccess(long... keys) {
        Set<Long> set = new HashSet<>();
        for (long key : keys) {
            set.add(key);
        }
        GridAccessSessions.put(ME, new GridAccess(GridAccess.UNRESOLVED_PLAYER_ID, set, System.currentTimeMillis()));
    }

    private static <T extends IAsyncRequest> T run(T request, String query) {
        request.handle(TestGridFixtures.context(ME, query));
        return request;
    }

    private static void assertStatus(String expected, IAsyncRequest request) {
        assertTrue(
            request.getJSON()
                .contains("\"status\":\"" + expected + "\""),
            "expected status " + expected + " but got " + request.getJSON());
    }

    // --- /itemhistory ---

    @Test
    void itemHistoryDeniesAMissingGridParam() {
        assertStatus("GRID_NOT_FOUND", run(new GetItemHistory(), ""));
    }

    @Test
    void itemHistoryDeniesAnUnrecognisedRange() {
        grantAccess(MY_GRID);
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "grid=" + MY_GRID + "&range=nonsense"));
    }

    @Test
    void itemHistoryDeniesANonNumericPointsParam() {
        grantAccess(MY_GRID);
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "grid=" + MY_GRID + "&points=notanumber"));
    }

    @Test
    void itemHistoryReturnsAnAllGapSeriesForAnUnknownItemid() {
        grantAccess(MY_GRID);
        GetItemHistory request = run(new GetItemHistory(), "grid=" + MY_GRID + "&items=minecraft:does_not_exist");
        assertStatus("OK", request);
        assertTrue(
            request.getJSON()
                .contains("\"itemid\":\"minecraft:does_not_exist\""));
    }

    @Test
    void itemHistoryReadNeverCreatesAGridDataEntry() {
        grantAccess(MY_GRID);
        run(new GetItemHistory(), "grid=" + MY_GRID);
        assertNull(GridData.find(MY_GRID), "a read must not fabricate a GridData entry");
    }

    // --- /trackeditems ---

    @Test
    void trackedItemsDeniesAMissingGridParam() {
        assertStatus("GRID_NOT_FOUND", run(new TrackedItems(), ""));
    }

    @Test
    void trackedItemsDeniesAnEmptyAddParam() {
        grantAccess(MY_GRID);
        assertStatus("BAD_PARAM", run(new TrackedItems(), "grid=" + MY_GRID + "&add="));
    }

    @Test
    void trackedItemsDeniesExceedingTheConfiguredCap() {
        grantAccess(MY_GRID);
        // Cap is set to 2 in setUp().
        assertStatus("TRACKED_LIMIT_REACHED", run(new TrackedItems(), "grid=" + MY_GRID + "&set=a,b,c"));
    }

    @Test
    void trackedItemsSetRoundTripsThroughTheResponse() {
        grantAccess(MY_GRID);
        TrackedItems request = run(new TrackedItems(), "grid=" + MY_GRID + "&set=minecraft:iron_ingot");
        assertStatus("OK", request);
        assertTrue(
            request.getJSON()
                .contains("minecraft:iron_ingot"));
    }

    @Test
    void trackedItemsReadNeverCreatesAGridDataEntry() {
        grantAccess(MY_GRID);
        run(new TrackedItems(), "grid=" + MY_GRID);
        assertNull(GridData.find(MY_GRID), "a plain read must not fabricate a GridData entry");
    }
}
