package pl.kuba6000.ae2webintegration.core.http;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.file.Files;
import java.util.List;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import pl.kuba6000.ae2webintegration.core.auth.AuthService;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.icons.ItemIconIndex;
import pl.kuba6000.ae2webintegration.core.utils.HTTPUtils;

/**
 * Serves a real item/fluid icon PNG by itemid (see {@link ItemIconIndex}), as {@code /icon?id=<itemid>}.
 * Outside the {@code /api} router because it answers with an image, not a JSON envelope. Not grid-scoped data,
 * so any authenticated principal may fetch any icon.
 */
public final class IconHandler implements HttpHandler {

    private static volatile ItemIconIndex itemIconIndex = ItemIconIndex.disabled();

    public static boolean isEnabled() {
        return itemIconIndex.isEnabled();
    }

    /**
     * Scanning a real icon export can be tens of thousands of files; doing that inline when the HTTP server
     * starts would delay the port opening (or a reload) on a cold directory listing. The old index keeps
     * serving lookups until the new one is ready.
     */
    public static void rebuildIndexAsync() {
        File directory = Config.itemIconDirectory();
        Thread scanThread = new Thread(
            () -> itemIconIndex = ItemIconIndex.scan(directory),
            "ae2webintegration-icon-scan");
        scanThread.setDaemon(true);
        scanThread.start();
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            if (AuthService.isRateLimited(exchange)) {
                exchange.sendResponseHeaders(ApiStatus.TOO_MANY_REQUESTS.httpStatus(), -1);
                return;
            }
            if (AuthService.authenticate(exchange) == null) {
                exchange.sendResponseHeaders(HttpURLConnection.HTTP_UNAUTHORIZED, -1);
                return;
            }

            String itemid = HTTPUtils.parseQueryString(
                exchange.getRequestURI()
                    .getRawQuery())
                .get("id");
            File icon = itemIconIndex.lookup(itemid);
            if (icon == null) {
                exchange.sendResponseHeaders(HttpURLConnection.HTTP_NOT_FOUND, -1);
                return;
            }

            String etag = "\"" + icon.length() + "-" + icon.lastModified() + "\"";
            List<String> ifNoneMatch = exchange.getRequestHeaders()
                .get("If-None-Match");
            if (ifNoneMatch != null && ifNoneMatch.contains(etag)) {
                exchange.sendResponseHeaders(HttpURLConnection.HTTP_NOT_MODIFIED, -1);
                return;
            }

            byte[] body;
            try {
                body = Files.readAllBytes(icon.toPath());
            } catch (IOException e) {
                // Deleted/unreadable between the index scan and this request - a 404 is the honest answer,
                // not a 500, since from the client's perspective the icon simply isn't there.
                exchange.sendResponseHeaders(HttpURLConnection.HTTP_NOT_FOUND, -1);
                return;
            }
            exchange.getResponseHeaders()
                .set("Content-Type", "image/png");
            exchange.getResponseHeaders()
                .set("Cache-Control", "public, max-age=604800, immutable");
            exchange.getResponseHeaders()
                .set("ETag", etag);
            exchange.sendResponseHeaders(HttpURLConnection.HTTP_OK, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        } finally {
            exchange.close();
        }
    }
}
