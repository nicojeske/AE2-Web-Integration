package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.github.bsideup.jabel.Desugar;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;

import pl.kuba6000.ae2webintegration.core.AE2Controller.RequestContext;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.ae2request.sync.ISyncedRequest;
import pl.kuba6000.ae2webintegration.core.http.ApiRouter;
import pl.kuba6000.ae2webintegration.core.http.contract.Body;
import pl.kuba6000.ae2webintegration.core.http.contract.Endpoint;
import pl.kuba6000.ae2webintegration.core.http.contract.HttpMethod;
import pl.kuba6000.ae2webintegration.core.http.contract.OptionalInput;
import pl.kuba6000.ae2webintegration.core.http.contract.PathParam;
import pl.kuba6000.ae2webintegration.core.http.contract.QueryParam;

class ApiRoutingHttpTest {

    private HttpServer server;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        ApiRouter router = new ApiRouter(exchange -> {
            boolean identified = "Bearer valid".equals(
                exchange.getRequestHeaders()
                    .getFirst("Authorization"))
                || "authenticationToken=valid".equals(
                    exchange.getRequestHeaders()
                        .getFirst("Cookie"));
            return identified ? new RequestContext(exchange, WebPrincipal.admin()) : null;
        }, exchange -> false, ISyncedRequest::handle);
        router.register(Echo.class);
        router.register(Read.class);
        router.register(FailingRead.class);
        router.register(Query.class);
        router.register(Store.class);
        server.createContext("/api", router);
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Endpoint(method = HttpMethod.PATCH, path = "/api/echo/{name}")
    public static class Echo extends ISyncedRequest {

        @PathParam("name")
        private String name;
        @Body
        private Input input;

        @Desugar
        public record Input(long count, @OptionalInput Boolean enabled) {}

        @Desugar
        public record Output(String name, long count, Boolean enabled) {}

        @Override
        public void handle() {
            succeed(new Output(name, input.count(), input.enabled()));
        }
    }

    @Endpoint(method = HttpMethod.GET, path = "/api/echo/{name}")
    public static class Read extends ISyncedRequest {

        @PathParam("name")
        private String name;

        @Override
        public void handle() {
            succeed(Collections.singletonMap("name", name));
        }
    }

    @Endpoint(method = HttpMethod.GET, path = "/api/query")
    public static class Query extends IAsyncRequest {

        @QueryParam("name")
        private String name;
        @QueryParam("count")
        @OptionalInput
        private int count = 3;
        @QueryParam("flag")
        @OptionalInput
        private Boolean flag;

        @Override
        public void handle() {
            JsonObject result = new JsonObject();
            result.addProperty("name", name);
            result.addProperty("count", count);
            result.addProperty("flag", flag);
            succeed(result);
        }
    }

    @Endpoint(method = HttpMethod.PUT, path = "/api/store", maxBodyBytes = 64 * 1024)
    public static class Store extends IAsyncRequest {

        @Body
        private Input input;

        public static final class Input {

            public String blob;
        }

        @Override
        public void handle() {
            succeed(Collections.singletonMap("length", input.blob.length()));
        }
    }

    @Test
    void queryParametersBindTypedAndKeepDefaultsWhenOptional() throws Exception {
        String bearer = "Authorization: Bearer valid\r\n";
        JsonObject full = request("GET", "/api/query?name=a%20b&count=7&flag=true", bearer, "").json()
            .getAsJsonObject("data");
        assertEquals(
            "a b",
            full.get("name")
                .getAsString());
        assertEquals(
            7,
            full.get("count")
                .getAsInt());
        assertTrue(
            full.get("flag")
                .getAsBoolean());

        JsonObject defaults = request("GET", "/api/query?name=x", bearer, "").json()
            .getAsJsonObject("data");
        assertEquals(
            3,
            defaults.get("count")
                .getAsInt());
        assertTrue(
            !defaults.has("flag") || defaults.get("flag")
                .isJsonNull());
    }

    @Test
    void malformedOrMissingRequiredQueryParametersAreBadParams() throws Exception {
        String bearer = "Authorization: Bearer valid\r\n";
        assertEquals(HttpURLConnection.HTTP_BAD_REQUEST, request("GET", "/api/query", bearer, "").status());
        assertEquals(
            HttpURLConnection.HTTP_BAD_REQUEST,
            request("GET", "/api/query?name=x&count=many", bearer, "").status());
        assertEquals(
            HttpURLConnection.HTTP_BAD_REQUEST,
            request("GET", "/api/query?name=x&flag=yes", bearer, "").status());
    }

    @Test
    void anEndpointCanRaiseItsBodyLimit() throws Exception {
        String headers = "Authorization: Bearer valid\r\nContent-Type: application/json\r\n";
        String large = new String(new char[32 * 1024]).replace('\0', 'x');
        Reply accepted = request("PUT", "/api/store", headers, "{\"blob\":\"" + large + "\"}");
        assertEquals(HttpURLConnection.HTTP_OK, accepted.status());

        String tooLarge = new String(new char[65 * 1024]).replace('\0', 'x');
        assertEquals(413, request("PUT", "/api/store", headers, "{\"blob\":\"" + tooLarge + "\"}").status());
        // Every other endpoint keeps the default limit.
        assertEquals(
            413,
            request("PATCH", "/api/echo/example", headers, "{\"count\":7,\"x\":\"" + large + "\"}").status());
    }

    @Test
    void handlerArgumentFailureIsAnInternalErrorRatherThanInvalidClientInput() throws Exception {
        Reply response = request("GET", "/api/failing", "Authorization: Bearer valid\r\n", "");
        assertEquals(HttpURLConnection.HTTP_INTERNAL_ERROR, response.status());
        assertEquals(
            "INTERNAL_ERROR",
            response.json()
                .get("status")
                .getAsString());
    }

    @Endpoint(method = HttpMethod.GET, path = "/api/failing")
    public static class FailingRead extends IAsyncRequest {

        @Override
        public void handle() {
            throw new IllegalArgumentException("Internal data cannot be processed");
        }
    }

    @Test
    void samePathDispatchesByMethodAndBindsStrictJson() throws Exception {
        Reply read = request("GET", "/api/echo/example", "Authorization: Bearer valid\r\n", "");
        assertEquals(HttpURLConnection.HTTP_OK, read.status());
        assertEquals(
            "example",
            read.json()
                .getAsJsonObject("data")
                .get("name")
                .getAsString());
        Reply patch = request(
            "PATCH",
            "/api/echo/example",
            "Authorization: Bearer valid\r\nContent-Type: application/json\r\n",
            "{\"count\":7}");
        assertEquals(HttpURLConnection.HTTP_OK, patch.status());
        assertEquals(
            7,
            patch.json()
                .getAsJsonObject("data")
                .get("count")
                .getAsLong());
        assertTrue(
            patch.json()
                .getAsJsonObject("data")
                .get("enabled")
                .isJsonNull());
        for (String body : new String[] { "{\"count\":\"7\"}", "{\"count\":7,\"enabled\":null}",
            "{\"count\":7,\"other\":0}", "{}" }) {
            assertEquals(
                HttpURLConnection.HTTP_BAD_REQUEST,
                request(
                    "PATCH",
                    "/api/echo/example",
                    "Authorization: Bearer valid\r\nContent-Type: application/json\r\n",
                    body).status());
        }
    }

    @Test
    void rejectsMalformedTransportAndProtectsCookieMutations() throws Exception {
        String bearer = "Authorization: Bearer valid\r\n";
        assertEquals(
            HttpURLConnection.HTTP_UNSUPPORTED_TYPE,
            request("PATCH", "/api/echo/example", bearer + "Content-Type: text/plain\r\n", "{\"count\":7}").status());
        assertEquals(
            HttpURLConnection.HTTP_BAD_REQUEST,
            request("PATCH", "/api/echo/example", bearer + "Content-Type: application/json\r\n", "{count:7}").status());
        assertEquals(
            HttpURLConnection.HTTP_ENTITY_TOO_LARGE,
            request(
                "PATCH",
                "/api/echo/example",
                bearer + "Content-Type: application/json\r\n",
                String.join("", Collections.nCopies(8193, " "))).status());
        String cookie = "Cookie: authenticationToken=valid\r\nContent-Type: application/json\r\n";
        assertEquals(
            HttpURLConnection.HTTP_FORBIDDEN,
            request("PATCH", "/api/echo/example", cookie, "{\"count\":7}").status());
        assertEquals(
            HttpURLConnection.HTTP_OK,
            request("PATCH", "/api/echo/example", cookie + "X-AE2-Request: true\r\n", "{\"count\":7}").status());
        assertEquals(HttpURLConnection.HTTP_NOT_FOUND, request("GET", "/api/echo/example/extra", bearer, "").status());
        assertEquals(HttpURLConnection.HTTP_BAD_METHOD, request("DELETE", "/api/echo/example", bearer, "").status());
    }

    private Reply request(String method, String path, String headers, String body) throws Exception {
        try (Socket socket = new Socket(
            InetAddress.getLoopbackAddress(),
            server.getAddress()
                .getPort())) {
            socket.setSoTimeout(3000);
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            OutputStream output = socket.getOutputStream();
            output.write(
                (method + " "
                    + path
                    + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                    + headers
                    + "Content-Length: "
                    + payload.length
                    + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(payload);
            output.flush();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            InputStream input = socket.getInputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
            String response = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            return new Reply(
                Integer.parseInt(response.split(" ", 3)[1]),
                response.substring(response.indexOf("\r\n\r\n") + 4));
        }
    }

    @Desugar
    private record Reply(int status, String body) {

        JsonObject json() {
            return new Gson().fromJson(body, JsonObject.class);
        }
    }
}
