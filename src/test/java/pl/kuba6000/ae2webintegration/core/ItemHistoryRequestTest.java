package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonObject;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.AddTrackedItem;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.GetItemHistory;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.GetTrackedItems;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.RemoveTrackedItem;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.SetTrackedItems;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;

class ItemHistoryRequestTest extends GridTestScope {

    private static final WebPrincipal OWNER = TestGridFixtures.principal(TestGridFixtures.OWNER_ID);
    private static final WebPrincipal STRANGER = TestGridFixtures.principal(43);

    private StableKey key;

    @BeforeEach
    void setUp() {
        TestGridFixtures.TestGrid grid = TestGridFixtures.grid(30L);
        key = TestGridFixtures.resolvedKey(grid);
        AE2Controller.AE2Interface = TestGridFixtures.ae(grid);
        Config.INSTANCE.statistics.maxTrackedItemsPerGrid = 2;
    }

    @AfterEach
    void resetConfig() {
        Config.INSTANCE.statistics.maxTrackedItemsPerGrid = 24;
    }

    private <T extends IAsyncRequest> T run(T request, WebPrincipal principal, String query, String itemid,
        JsonObject body) {
        Map<String, String> path = new HashMap<>();
        path.put("gridKey", key.toString());
        if (itemid != null) path.put("itemid", itemid);
        request
            .handle(new AE2Controller.RequestContext(new TestGridFixtures.TestExchange(query), principal, path, body));
        return request;
    }

    private <T extends IAsyncRequest> T run(T request, String query) {
        return run(request, OWNER, query, null, null);
    }

    private static JsonObject items(String csv) {
        JsonObject body = new JsonObject();
        body.addProperty("items", csv);
        return body;
    }

    private static void assertStatus(String expected, IAsyncRequest request) {
        assertTrue(
            request.getJSON()
                .contains("\"status\":\"" + expected + "\""),
            "expected status " + expected + " but got " + request.getJSON());
    }

    // --- item-history ---

    @Test
    void itemHistoryDeniesAPlayerWithoutGridAccess() {
        assertStatus("NO_PERMISSIONS", run(new GetItemHistory(), STRANGER, "", null, null));
    }

    @Test
    void itemHistoryDeniesAnUnrecognisedRange() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "range=nonsense"));
    }

    @Test
    void itemHistoryDeniesANonNumericPointsParam() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "points=notanumber"));
    }

    @Test
    void itemHistoryAcceptsTheFinerPresetRanges() {
        assertStatus("OK", run(new GetItemHistory(), "range=15m"));
        assertStatus("OK", run(new GetItemHistory(), "range=1h"));
        assertStatus("OK", run(new GetItemHistory(), "range=6h"));
    }

    @Test
    void itemHistoryCustomRangeDeniesAMissingOrInvalidMinutesParam() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "range=custom"));
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "range=custom&minutes=0"));
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "range=custom&minutes=notanumber"));
    }

    @Test
    void itemHistoryCustomRangeAcceptsAValidMinutesParam() {
        assertStatus("OK", run(new GetItemHistory(), "range=custom&minutes=90"));
    }

    @Test
    void itemHistoryReturnsAnAllGapSeriesForAnUnknownItemid() {
        GetItemHistory request = run(new GetItemHistory(), "items=minecraft:does_not_exist");
        assertStatus("OK", request);
        assertTrue(
            request.getJSON()
                .contains("\"itemid\":\"minecraft:does_not_exist\""));
    }

    @Test
    void itemHistoryDefaultsToTheTrackedItems() {
        run(new SetTrackedItems(), OWNER, "", null, items("minecraft:iron_ingot"));

        GetItemHistory request = run(new GetItemHistory(), "");

        assertTrue(
            request.getJSON()
                .contains("\"itemid\":\"minecraft:iron_ingot\""),
            request.getJSON());
    }

    // --- tracked-items ---

    @Test
    void trackedItemsDeniesAPlayerWithoutGridAccess() {
        assertStatus("NO_PERMISSIONS", run(new GetTrackedItems(), STRANGER, "", null, null));
    }

    @Test
    void addingABlankItemIsABadParam() {
        assertStatus("BAD_PARAM", run(new AddTrackedItem(), OWNER, "", " ", null));
    }

    @Test
    void trackedItemsDeniesExceedingTheConfiguredCap() {
        // Cap is set to 2 in setUp().
        assertStatus("TRACKED_LIMIT_REACHED", run(new SetTrackedItems(), OWNER, "", null, items("a,b,c")));
        run(new AddTrackedItem(), OWNER, "", "a", null);
        run(new AddTrackedItem(), OWNER, "", "b", null);
        assertStatus("TRACKED_LIMIT_REACHED", run(new AddTrackedItem(), OWNER, "", "c", null));
    }

    @Test
    void setAddAndRemoveRoundTripThroughTheSettings() {
        assertStatus("OK", run(new SetTrackedItems(), OWNER, "", null, items("minecraft:iron_ingot")));
        assertStatus("OK", run(new AddTrackedItem(), OWNER, "", "minecraft:gold_ingot", null));
        assertEquals(Arrays.asList("minecraft:iron_ingot", "minecraft:gold_ingot"), trackedItems());

        assertStatus("OK", run(new RemoveTrackedItem(), OWNER, "", "minecraft:iron_ingot", null));
        assertEquals(Arrays.asList("minecraft:gold_ingot"), trackedItems());

        GetTrackedItems read = run(new GetTrackedItems(), "");
        assertTrue(
            read.getJSON()
                .contains("\"tracked\":[\"minecraft:gold_ingot\"]"),
            read.getJSON());
    }

    @Test
    void anEmptySetClearsTheTrackedItems() {
        run(new SetTrackedItems(), OWNER, "", null, items("minecraft:iron_ingot"));

        assertStatus("OK", run(new SetTrackedItems(), OWNER, "", null, items("")));

        assertTrue(trackedItems().isEmpty());
    }

    private java.util.List<String> trackedItems() {
        synchronized (CoreEngine.GRID_IDENTITIES) {
            return new java.util.ArrayList<>(
                CoreEngine.GRID_IDENTITIES.getPersistentData(key)
                    .getSettings()
                    .getTrackedItems());
        }
    }
}
