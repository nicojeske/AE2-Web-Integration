package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.*;

import java.io.File;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import pl.kuba6000.ae2webintegration.core.ae2request.IRequest;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.http.endpoint.stock.DeleteStockRule;
import pl.kuba6000.ae2webintegration.core.http.endpoint.stock.GetStockRules;
import pl.kuba6000.ae2webintegration.core.http.endpoint.stock.PutStockRule;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

@SuppressWarnings("PMD.AvoidMagicNumbers")
class StockRuleRequestTest extends GridTestScope {

    private static final String IRON = "minecraft:iron_ingot:0";
    private static final int STRANGER = 99;

    private StableKey key;

    @BeforeEach
    void grantGridAccess() {
        TestGridFixtures.TestGrid grid = TestGridFixtures.grid(1);
        key = CoreEngine.GRID_IDENTITIES.getKey(grid);
        assertNotNull(key);
    }

    @Test
    void putThenGetThenDelete() {
        JsonObject put = run(new PutStockRule(), TestGridFixtures.OWNER_ID, IRON, body(100, 200, 64, true));
        assertEquals(
            "OK",
            put.get("status")
                .getAsString());
        JsonObject stored = put.getAsJsonObject("data");
        assertEquals(
            IRON,
            stored.get("itemid")
                .getAsString());
        assertEquals(
            200,
            stored.get("keepStock")
                .getAsLong());
        assertEquals(
            -1,
            stored.get("stored")
                .getAsLong());

        JsonArray rules = run(new GetStockRules(), TestGridFixtures.OWNER_ID, null, null).getAsJsonArray("data");
        assertEquals(1, rules.size());
        assertTrue(
            rules.get(0)
                .getAsJsonObject()
                .get("autoCraft")
                .getAsBoolean());

        // Persisted, so the server's checks and a restart see it.
        GridIdentityRegistry reloaded = reload();
        assertEquals(
            1,
            reloaded.getPersistentData(key)
                .getStockRules()
                .rules()
                .size());

        assertEquals(
            "OK",
            run(new DeleteStockRule(), TestGridFixtures.OWNER_ID, IRON, null).get("status")
                .getAsString());
        assertEquals(
            "NOT_FOUND",
            run(new DeleteStockRule(), TestGridFixtures.OWNER_ID, IRON, null).get("status")
                .getAsString());
        assertEquals(
            0,
            run(new GetStockRules(), TestGridFixtures.OWNER_ID, null, null).getAsJsonArray("data")
                .size());
    }

    @Test
    void invalidRulesAreRejected() {
        assertEquals(
            "BAD_PARAM",
            run(new PutStockRule(), TestGridFixtures.OWNER_ID, IRON, body(1, 1, 0, false)).get("status")
                .getAsString());
        assertEquals(
            "BAD_PARAM",
            run(new PutStockRule(), TestGridFixtures.OWNER_ID, IRON, body(-1, 1, 1, false)).get("status")
                .getAsString());
        JsonObject missing = body(1, 1, 1, false);
        missing.remove("autoCraft");
        assertEquals(
            "BAD_PARAM",
            run(new PutStockRule(), TestGridFixtures.OWNER_ID, IRON, missing).get("status")
                .getAsString());
        assertEquals(
            0,
            run(new GetStockRules(), TestGridFixtures.OWNER_ID, null, null).getAsJsonArray("data")
                .size());
    }

    @Test
    void playersWithoutGridAccessCannotReadOrEdit() {
        assertEquals(
            "NO_PERMISSIONS",
            run(new GetStockRules(), STRANGER, null, null).get("status")
                .getAsString());
        assertEquals(
            "NO_PERMISSIONS",
            run(new PutStockRule(), STRANGER, IRON, body(1, 1, 1, false)).get("status")
                .getAsString());
    }

    private GridIdentityRegistry reload() {
        try {
            return new GridIdentityRegistry(new File(gridSave, "ae2webintegration/grid-identities.json"));
        } catch (java.io.IOException e) {
            throw new AssertionError(e);
        }
    }

    private static JsonObject body(long alertBelow, long keepStock, long batchSize, boolean autoCraft) {
        JsonObject body = new JsonObject();
        body.addProperty("alertBelow", alertBelow);
        body.addProperty("keepStock", keepStock);
        body.addProperty("batchSize", batchSize);
        body.addProperty("autoCraft", autoCraft);
        return body;
    }

    private JsonObject run(IAsyncRequest request, int player, String itemid, JsonObject body) {
        Map<String, String> path = new HashMap<>();
        path.put("gridKey", key.toString());
        if (itemid != null) path.put("itemid", itemid);
        request.handle(
            new AE2Controller.RequestContext(
                new TestGridFixtures.TestExchange(""),
                TestGridFixtures.principal(player),
                path,
                body == null ? new JsonObject() : body));
        return response(request);
    }

    private static JsonObject response(IRequest request) {
        return GSONUtils.GSON_BUILDER.create()
            .fromJson(request.getJSON(), JsonObject.class);
    }
}
