package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.Collections;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.google.gson.JsonObject;

import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.ConfigTestFixture;
import pl.kuba6000.ae2webintegration.core.config.CoreData;
import pl.kuba6000.ae2webintegration.core.http.endpoint.prefs.GetPrefs;
import pl.kuba6000.ae2webintegration.core.http.endpoint.prefs.PutPrefs;

class PrefsRequestTest {

    @TempDir
    File configRoot;

    private ConfigTestFixture config;

    @BeforeEach
    void loadData() {
        config = new ConfigTestFixture(configRoot);
        CoreData.loadData();
    }

    @AfterEach
    void restoreConfig() {
        config.close();
    }

    private static <T extends IAsyncRequest> T run(T request, WebPrincipal principal, JsonObject body) {
        request.handle(
            new AE2Controller.RequestContext(
                new TestGridFixtures.TestExchange(""),
                principal,
                Collections.emptyMap(),
                body));
        return request;
    }

    private static JsonObject blob(String value) {
        JsonObject body = new JsonObject();
        body.addProperty("blob", value);
        return body;
    }

    @Test
    void nothingStoredReadsAsANullBlob() {
        String json = run(new GetPrefs(), TestGridFixtures.principal(201), null).getJSON();
        assertTrue(json.contains("\"blob\":null"), json);
    }

    @Test
    void aStoredBlobIsReadBackOpaquelyPerPlayer() {
        WebPrincipal alice = TestGridFixtures.principal(202);
        run(new PutPrefs(), alice, blob("{\"favorites\":[\"a\"]}"));

        String own = run(new GetPrefs(), alice, null).getJSON();
        assertTrue(own.contains("{\\\"favorites\\\":[\\\"a\\\"]}"), own);
        String other = run(new GetPrefs(), TestGridFixtures.principal(203), null).getJSON();
        assertTrue(other.contains("\"blob\":null"), other);
    }

    @Test
    void adminAndLocalhostShareOneBlob() {
        run(new PutPrefs(), WebPrincipal.admin(), blob("shared"));

        assertEquals(
            run(new GetPrefs(), WebPrincipal.admin(), null).getJSON(),
            run(new GetPrefs(), WebPrincipal.localhost(), null).getJSON());
    }

    @Test
    void aMissingBlobIsABadParam() {
        String json = run(new PutPrefs(), WebPrincipal.admin(), new JsonObject()).getJSON();
        assertTrue(json.contains("\"status\":\"BAD_PARAM\""), json);
    }
}
