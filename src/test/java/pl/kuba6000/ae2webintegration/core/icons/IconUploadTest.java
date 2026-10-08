package pl.kuba6000.ae2webintegration.core.icons;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Tests for {@link IconUpload} - staging, validation and the swap into the live icon directory. */
class IconUploadTest {

    @TempDir
    File root;

    private File live;
    private final AtomicInteger reindexed = new AtomicInteger();
    private final List<String> replies = new ArrayList<>();
    private IconUpload upload;

    @BeforeEach
    void setUp() {
        live = new File(root, "icons");
        // Runs writer tasks inline, so every call's file work is done when it returns.
        upload = new IconUpload(() -> live, reindexed::incrementAndGet, Runnable::run);
    }

    private static byte[] png(int size) {
        byte[] data = new byte[size];
        byte[] signature = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n' };
        System.arraycopy(signature, 0, data, 0, signature.length);
        return data;
    }

    private File icon(String itemid) {
        return new File(live, IconFileNames.fileName(itemid));
    }

    @Test
    void finishedUploadReplacesTheLiveIcons() throws Exception {
        assertTrue(live.mkdirs());
        Files.write(icon("minecraft:stone:0").toPath(), png(16));

        assertNull(upload.begin("alice", replies::add));
        byte[] chlorine = png(20);
        upload.accept("alice", "chlorine", chlorine);
        upload.accept("alice", "gregtech:gt.metaitem.01:11020", png(24));
        upload.finish("alice");

        assertArrayEquals(chlorine, Files.readAllBytes(icon("chlorine").toPath()));
        assertTrue(icon("gregtech:gt.metaitem.01:11020").isFile());
        assertFalse(icon("minecraft:stone:0").exists());
        assertFalse(new File(root, "icons.uploading").exists());
        assertFalse(new File(root, "icons.old").exists());
        assertEquals(1, reindexed.get());
        assertEquals(Arrays.asList("Installed 2 icons on the server."), replies);
    }

    @Test
    void invalidIconsAreRejectedAndCounted() {
        assertNull(upload.begin("alice", replies::add));
        upload.accept("alice", "chlorine", png(16));
        upload.accept("alice", "chlorine", new byte[] { 1, 2, 3 });
        upload.accept("alice", "benzene", png(IconUpload.MAX_ICON_BYTES + 1));
        upload.accept("alice", null, png(16));
        upload.finish("alice");

        String[] names = live.list();
        assertNotNull(names);
        assertEquals(1, names.length);
        assertEquals(Arrays.asList("Installed 1 icons on the server (3 rejected)."), replies);
    }

    @Test
    void uploadWithNoValidIconsKeepsTheLiveIcons() throws Exception {
        assertTrue(live.mkdirs());
        Files.write(icon("minecraft:stone:0").toPath(), png(16));
        assertNull(upload.begin("alice", replies::add));
        upload.accept("alice", "chlorine", new byte[] { 1 });
        upload.finish("alice");

        assertTrue(icon("minecraft:stone:0").isFile());
        assertEquals(0, reindexed.get());
        assertTrue(
            replies.get(0)
                .startsWith("No valid icons"));
    }

    @Test
    void abortKeepsTheLiveIconsAndRemovesTheStagedOnes() throws Exception {
        assertTrue(live.mkdirs());
        Files.write(icon("minecraft:stone:0").toPath(), png(16));
        assertNull(upload.begin("alice", replies::add));
        upload.accept("alice", "chlorine", png(16));
        upload.abort("alice");

        assertTrue(icon("minecraft:stone:0").isFile());
        assertFalse(icon("chlorine").exists());
        assertFalse(new File(root, "icons.uploading").exists());
        assertTrue(replies.isEmpty());
        // The slot is free again.
        assertNull(upload.begin("bob", replies::add));
    }

    @Test
    void onlyOneUploadRunsAtATimeAndOthersAreIgnored() {
        assertNull(upload.begin("alice", replies::add));
        assertNotNull(upload.begin("bob", replies::add));
        assertNotNull(upload.begin("alice", replies::add));

        upload.accept("bob", "chlorine", png(16));
        upload.finish("bob");
        upload.abort("bob");
        upload.accept("alice", "benzene", png(16));
        upload.finish("alice");

        assertFalse(icon("chlorine").exists());
        assertTrue(icon("benzene").isFile());
        assertEquals(Arrays.asList("Installed 1 icons on the server."), replies);
    }
}
