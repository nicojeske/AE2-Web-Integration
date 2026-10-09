package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport;
import pl.kuba6000.ae2webintegration.core.history.HistoryDbTestSupport.Flavor;
import pl.kuba6000.ae2webintegration.core.http.endpoint.statistics.GetItemHistory;
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
        HistoryDbTestSupport.start(Flavor.TIMESCALE);
    }

    @AfterEach
    void tearDown() {
        HistoryDbTestSupport.stop();
    }

    private <T extends IAsyncRequest> T run(T request, WebPrincipal principal, String query) {
        Map<String, String> path = new HashMap<>();
        path.put("gridKey", key.toString());
        request
            .handle(new AE2Controller.RequestContext(new TestGridFixtures.TestExchange(query), principal, path, null));
        return request;
    }

    private <T extends IAsyncRequest> T run(T request, String query) {
        return run(request, OWNER, query);
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
        assertStatus("NO_PERMISSIONS", run(new GetItemHistory(), STRANGER, "items=a"));
    }

    @Test
    void itemHistoryDeniesAnUnrecognisedRange() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=a&range=nonsense"));
    }

    @Test
    void itemHistoryDeniesANonNumericPointsParam() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=a&points=notanumber"));
    }

    @Test
    void itemHistoryNeedsBetweenOneAndFiftyItems() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), ""));
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=,"));
        StringBuilder many = new StringBuilder("items=i0");
        for (int i = 1; i <= 50; i++) {
            many.append(",i")
                .append(i);
        }
        assertStatus("BAD_PARAM", run(new GetItemHistory(), many.toString()));
    }

    @Test
    void itemHistoryAcceptsTheFinerPresetRanges() {
        assertStatus("OK", run(new GetItemHistory(), "items=a&range=15m"));
        assertStatus("OK", run(new GetItemHistory(), "items=a&range=1h"));
        assertStatus("OK", run(new GetItemHistory(), "items=a&range=6h"));
    }

    @Test
    void itemHistoryCustomRangeDeniesAMissingOrInvalidMinutesParam() {
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=a&range=custom"));
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=a&range=custom&minutes=0"));
        assertStatus("BAD_PARAM", run(new GetItemHistory(), "items=a&range=custom&minutes=notanumber"));
    }

    @Test
    void itemHistoryCustomRangeAcceptsAValidMinutesParam() {
        assertStatus("OK", run(new GetItemHistory(), "items=a&range=custom&minutes=90"));
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
    void itemHistoryWithoutADatabaseIsDisabled() {
        HistoryDbTestSupport.stop();
        assertStatus("HISTORY_DISABLED", run(new GetItemHistory(), "items=a"));
    }
}
