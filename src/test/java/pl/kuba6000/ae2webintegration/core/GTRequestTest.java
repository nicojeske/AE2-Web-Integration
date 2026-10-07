package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.math.BigInteger;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTMachine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTMachines;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTPower;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTPowerHistory;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTProduction;
import pl.kuba6000.ae2webintegration.core.ae2request.async.gt.GetGTProductionHistory;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.gt.GTProductionLog;
import pl.kuba6000.ae2webintegration.core.gt.GTTestSupport;

/**
 * The {@code /gt/*} endpoints at the request-handler level, the way {@code ItemHistoryRequestTest} drives
 * the item-history ones: through {@code IAsyncRequest} directly, no HTTP server involved.
 */
class GTRequestTest {

    private static final int ALICE_ID = 101;
    private static final int BOB_ID = 102;
    private static final int CAROL_ID = 103;
    private static final UUID ALICE = TestGridFixtures.playerIdentity(ALICE_ID).uuid;
    private static final UUID BOB = TestGridFixtures.playerIdentity(BOB_ID).uuid;
    private static final UUID CAROL = TestGridFixtures.playerIdentity(CAROL_ID).uuid;

    @TempDir
    File configRoot;

    private GTTestSupport.FakeProvider provider;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
        GTTestSupport.reset();
        provider = new GTTestSupport.FakeProvider();
    }

    @AfterEach
    void tearDown() {
        GTTestSupport.reset();
    }

    private static <T extends IAsyncRequest> JsonObject run(T request, int userId, String query) {
        request.handle(TestGridFixtures.context(userId, query));
        return new JsonParser().parse(request.getJSON())
            .getAsJsonObject();
    }

    private static void assertStatus(String expected, JsonObject response) {
        assertEquals(
            expected,
            response.get("status")
                .getAsString(),
            response.toString());
    }

    /** Alice and Bob are one team (Alice leads); Carol is alone. Each owns one machine. */
    private void scanThreeOwners() {
        provider.next.machines.add(GTTestSupport.machine(1, ALICE, GTMachineStatus.RUNNING));
        provider.next.machines.add(GTTestSupport.machine(2, BOB, GTMachineStatus.MAINTENANCE));
        provider.next.machines.add(GTTestSupport.machine(3, CAROL, GTMachineStatus.IDLE));
        provider.next.teams.put(ALICE, ALICE);
        provider.next.teams.put(BOB, ALICE);
        GTTestSupport.scan(provider, System.currentTimeMillis());
    }

    @Test
    void everyEndpointAnswersNotAvailableWithoutProvider() {
        assertStatus("NOT_AVAILABLE", run(new GetGTMachines(), ALICE_ID, ""));
        assertStatus("NOT_AVAILABLE", run(new GetGTMachine(), ALICE_ID, "id=0:1:64:0"));
        assertStatus("NOT_AVAILABLE", run(new GetGTPower(), ALICE_ID, ""));
        assertStatus("NOT_AVAILABLE", run(new GetGTPowerHistory(), ALICE_ID, "source=x"));
        assertStatus("NOT_AVAILABLE", run(new GetGTProduction(), ALICE_ID, ""));
        assertStatus("NOT_AVAILABLE", run(new GetGTProductionHistory(), ALICE_ID, ""));
    }

    @Test
    void playersSeeTheirTeamsMachinesOnlyAndProblemsComeFirst() {
        scanThreeOwners();

        JsonObject bob = run(new GetGTMachines(), BOB_ID, "");
        assertStatus("OK", bob);
        JsonArray machines = bob.getAsJsonObject("data")
            .getAsJsonArray("machines");
        assertEquals(2, machines.size());
        assertEquals(
            "MAINTENANCE",
            machines.get(0)
                .getAsJsonObject()
                .get("status")
                .getAsString());
        assertEquals(
            "RUNNING",
            machines.get(1)
                .getAsJsonObject()
                .get("status")
                .getAsString());
        JsonObject summary = bob.getAsJsonObject("data")
            .getAsJsonObject("summary");
        assertEquals(
            1,
            summary.get("RUNNING")
                .getAsInt());
        assertEquals(
            0,
            summary.get("NO_POWER")
                .getAsInt(),
            "every status is present");

        JsonObject carol = run(new GetGTMachines(), CAROL_ID, "");
        assertEquals(
            1,
            carol.getAsJsonObject("data")
                .getAsJsonArray("machines")
                .size());

        JsonObject admin = run(new GetGTMachines(), -1, "");
        assertEquals(
            3,
            admin.getAsJsonObject("data")
                .getAsJsonArray("machines")
                .size());
    }

    @Test
    void ownerlessMachinesAreAdminOnly() {
        provider.next.machines.add(GTTestSupport.machine(1, null, GTMachineStatus.IDLE));
        GTTestSupport.scan(provider, System.currentTimeMillis());

        assertEquals(
            0,
            run(new GetGTMachines(), ALICE_ID, "").getAsJsonObject("data")
                .getAsJsonArray("machines")
                .size());
        assertEquals(
            1,
            run(new GetGTMachines(), -2, "").getAsJsonObject("data")
                .getAsJsonArray("machines")
                .size());
    }

    @Test
    void anInvisibleMachineLooksMissing() {
        scanThreeOwners();
        String carolsMachine = GTMachineSnapshot.idOf(0, 3, 64, 0);

        assertStatus("NOT_FOUND", run(new GetGTMachine(), ALICE_ID, "id=" + carolsMachine));
        assertStatus("NOT_FOUND", run(new GetGTMachine(), ALICE_ID, "id=0:999:0:0"));
        assertStatus("NO_PARAM", run(new GetGTMachine(), ALICE_ID, ""));

        JsonObject own = run(new GetGTMachine(), CAROL_ID, "id=" + carolsMachine);
        assertStatus("OK", own);
        assertEquals(
            "Machine 3",
            own.getAsJsonObject("data")
                .getAsJsonObject("machine")
                .get("name")
                .getAsString());
    }

    @Test
    void powerAmountsAreStringsWithFillAndTimeToEmpty() {
        // 1000 of 4000 EU, draining 10 EU/t net -> 100 ticks -> 5 s.
        provider.next.powerSources.add(GTTestSupport.lsc(1, ALICE, 1000, 4000, 5L, 15L));
        BigInteger huge = BigInteger.TEN.pow(30);
        provider.next.powerSources.add(GTTestSupport.wireless(CAROL, huge));
        GTTestSupport.scan(provider, System.currentTimeMillis());

        JsonObject response = run(new GetGTPower(), ALICE_ID, "");
        assertStatus("OK", response);
        JsonArray sources = response.getAsJsonObject("data")
            .getAsJsonArray("sources");
        assertEquals(1, sources.size(), "Carol's wireless network is not Alice's");
        JsonObject lsc = sources.get(0)
            .getAsJsonObject();
        assertEquals(
            "1000",
            lsc.get("stored")
                .getAsString());
        assertEquals(
            "4000",
            lsc.get("capacity")
                .getAsString());
        assertEquals(
            0.25,
            lsc.get("fill")
                .getAsDouble(),
            1e-9);
        assertEquals(
            -10,
            lsc.get("netPerTick")
                .getAsLong());
        assertEquals(
            5,
            lsc.get("secondsToEmpty")
                .getAsLong());
        assertTrue(
            lsc.get("secondsToFull")
                .isJsonNull());
        assertTrue(
            lsc.get("loaded")
                .getAsBoolean());

        JsonObject carol = run(new GetGTPower(), CAROL_ID, "");
        JsonObject wireless = carol.getAsJsonObject("data")
            .getAsJsonArray("sources")
            .get(0)
            .getAsJsonObject();
        assertEquals(
            huge.toString(),
            wireless.get("stored")
                .getAsString());
        assertTrue(
            wireless.get("capacity")
                .isJsonNull());
        assertTrue(
            wireless.get("fill")
                .isJsonNull());
    }

    @Test
    void powerHistoryChecksVisibilityAndParams() {
        provider.next.powerSources.add(GTTestSupport.lsc(1, ALICE, 1000, 4000, 5L, 15L));
        GTTestSupport.scan(provider, System.currentTimeMillis());
        String id = provider.next.powerSources.get(0).id;

        assertStatus("OK", run(new GetGTPowerHistory(), ALICE_ID, "source=" + id + "&range=1h"));
        assertStatus("NOT_FOUND", run(new GetGTPowerHistory(), CAROL_ID, "source=" + id));
        assertStatus("NO_PARAM", run(new GetGTPowerHistory(), ALICE_ID, ""));
        assertStatus("BAD_PARAM", run(new GetGTPowerHistory(), ALICE_ID, "source=" + id + "&range=forever"));
        assertStatus("BAD_PARAM", run(new GetGTPowerHistory(), ALICE_ID, "source=" + id + "&points=0"));
    }

    @Test
    void productionGroupsByItemOrMachineAndFiltersOwners() {
        scanThreeOwners();
        long now = System.currentTimeMillis();
        String alices = GTMachineSnapshot.idOf(0, 1, 64, 0);
        String bobs = GTMachineSnapshot.idOf(0, 2, 64, 0);
        String carols = GTMachineSnapshot.idOf(0, 3, 64, 0);
        GTProductionLog.record(alices, "EBF", ALICE, "gt:ingot:1", "Titanium Ingot", 30, false, now);
        GTProductionLog.record(bobs, "Vac", BOB, "gt:ingot:1", "Titanium Ingot", 10, false, now);
        GTProductionLog.record(bobs, "Vac", BOB, "helium", "Helium", 1000, true, now);
        GTProductionLog.record(carols, "EBF", CAROL, "gt:ingot:1", "Titanium Ingot", 500, false, now);

        JsonObject byItem = run(new GetGTProduction(), ALICE_ID, "range=1h&groupBy=item");
        assertStatus("OK", byItem);
        JsonArray rows = byItem.getAsJsonObject("data")
            .getAsJsonArray("rows");
        assertEquals(2, rows.size());
        JsonObject helium = rows.get(0)
            .getAsJsonObject();
        assertEquals(
            "helium",
            helium.get("key")
                .getAsString());
        assertTrue(
            helium.get("fluid")
                .getAsBoolean());
        JsonObject titanium = rows.get(1)
            .getAsJsonObject();
        assertEquals(
            40,
            titanium.get("total")
                .getAsLong(),
            "Carol's 500 are not counted");
        assertEquals(
            2,
            titanium.getAsJsonArray("breakdown")
                .size());
        assertEquals(
            alices,
            titanium.getAsJsonArray("breakdown")
                .get(0)
                .getAsJsonObject()
                .get("key")
                .getAsString(),
            "breakdown is largest first");

        JsonObject byMachine = run(new GetGTProduction(), ALICE_ID, "range=1h&groupBy=machine");
        JsonArray machineRows = byMachine.getAsJsonObject("data")
            .getAsJsonArray("rows");
        assertEquals(
            bobs,
            machineRows.get(0)
                .getAsJsonObject()
                .get("key")
                .getAsString());
        assertEquals(
            1010,
            machineRows.get(0)
                .getAsJsonObject()
                .get("total")
                .getAsLong());

        JsonObject oneMachine = run(new GetGTProduction(), ALICE_ID, "range=1h&machine=" + alices);
        assertEquals(
            1,
            oneMachine.getAsJsonObject("data")
                .getAsJsonArray("rows")
                .size());

        assertStatus("BAD_PARAM", run(new GetGTProduction(), ALICE_ID, "groupBy=owner"));
    }

    @Test
    void productionHistoryIsServedPerItem() {
        scanThreeOwners();
        long now = System.currentTimeMillis();
        GTProductionLog.record(GTMachineSnapshot.idOf(0, 1, 64, 0), "EBF", ALICE, "gt:ingot:1", "Ti", 30, false, now);

        JsonObject response = run(new GetGTProductionHistory(), ALICE_ID, "item=gt:ingot:1&range=24h");
        assertStatus("OK", response);
        JsonArray points = response.getAsJsonObject("data")
            .getAsJsonArray("points");
        assertEquals(
            30,
            points.get(points.size() - 1)
                .getAsLong());

        JsonObject carol = run(new GetGTProductionHistory(), CAROL_ID, "item=gt:ingot:1&range=24h");
        JsonArray carolPoints = carol.getAsJsonObject("data")
            .getAsJsonArray("points");
        assertEquals(
            0,
            carolPoints.get(carolPoints.size() - 1)
                .getAsLong());
        assertFalse(carolPoints.size() == 0);
    }
}
