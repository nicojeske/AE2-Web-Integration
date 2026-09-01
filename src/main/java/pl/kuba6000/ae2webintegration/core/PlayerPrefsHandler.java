package pl.kuba6000.ae2webintegration.core;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import pl.kuba6000.ae2webintegration.core.config.CoreData;

/**
 * Syncs the web terminal's favourites/thresholds/browser filters/saved stats views across devices - see
 * {@code CoreData}'s own doc on {@code prefsBlobs} for why this never parses the blob's contents.
 * <p>
 * Not an {@code IAsyncRequest}: those are grid-scoped by contract (a {@code grid} param,
 * {@link GridAccessSessions} authorization), and prefs are neither - they follow the logged-in
 * principal, not any one grid. A bespoke {@link HttpHandler} instead, the same shape as
 * {@code AE2Controller}'s own {@code IconHandler}/{@code AuthHandler}.
 * <p>
 * Read vs write is decided by request body presence, not HTTP method (GET/POST) - consistent with every
 * other endpoint here (e.g. {@code /gridsettings}'s {@code track} param), and it means an intermediary
 * that silently drops a POST body (as {@code example_website/index.php}'s generic reverse proxy
 * currently does for every route) degrades to a harmless read instead of wiping the stored blob.
 */
public class PlayerPrefsHandler implements HttpHandler {

    /**
     * Far larger than every other POST body this server accepts ({@code AE2Controller.MAX_BODY_BYTES})
     * - a synced prefs blob holds an unbounded number of favourited items and saved compare views.
     */
    private static final int MAX_PREFS_BODY_BYTES = 256 * 1024;

    @Override
    public void handle(HttpExchange t) throws IOException {
        if (AE2Controller.preHTTPHandler(t)) return;

        UUID prefsKey = AE2Controller.requestContext.get()
            .getPrincipal()
            .prefsKey();

        String body = AE2Controller.readBody(t, MAX_PREFS_BODY_BYTES);
        if (body == null) {
            JsonObject envelope = new JsonObject();
            envelope.addProperty("status", "TOO_LARGE");
            sendJson(t, envelope);
            return;
        }
        if (!body.isEmpty()) {
            CoreData.setPrefsBlob(prefsKey, body);
        }

        JsonObject data = new JsonObject();
        // Accepts null and serializes it as a JSON null - never a bare 200 with a missing field, so the
        // client can tell "nothing synced yet" apart from a malformed response.
        data.addProperty("blob", CoreData.getPrefsBlob(prefsKey));
        JsonObject envelope = new JsonObject();
        envelope.addProperty("status", "OK");
        envelope.add("data", data);
        sendJson(t, envelope);
    }

    private static void sendJson(HttpExchange t, JsonObject json) throws IOException {
        byte[] raw = json.toString()
            .getBytes(StandardCharsets.UTF_8);
        t.getResponseHeaders()
            .set("Content-Type", "application/json");
        t.sendResponseHeaders(200, raw.length);
        try (OutputStream os = t.getResponseBody()) {
            os.write(raw);
        }
    }
}
