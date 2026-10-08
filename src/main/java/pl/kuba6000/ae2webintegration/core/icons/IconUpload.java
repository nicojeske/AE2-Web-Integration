package pl.kuba6000.ae2webintegration.core.icons;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.stream.Stream;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.http.IconHandler;

/**
 * Receives the icons a client renders with {@code /ae2webicons export} and installs them as the server's icon
 * directory. One upload at a time: icons are staged next to the live directory and swapped in whole once the
 * client says it's done, so an interrupted upload never leaves a half-replaced set behind.
 * <p>
 * The adapter calls this from its network thread; every file operation runs in order on one writer thread, so a
 * handler never blocks on disk and a new upload's cleanup can't overtake the previous one's commit.
 */
public final class IconUpload {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    public static final int MAX_ICON_BYTES = 64 * 1024;
    public static final long MAX_UPLOAD_BYTES = 256L * 1024 * 1024;

    private static final byte[] PNG_SIGNATURE = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n' };

    private static final IconUpload INSTANCE = new IconUpload(
        Config::iconDirectory,
        IconHandler::rebuildIndex,
        Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "ae2webintegration-icon-upload");
            thread.setDaemon(true);
            return thread;
        }));

    private final Supplier<File> directory;
    private final Runnable reindex;
    private final Executor writer;
    private Session active;

    IconUpload(Supplier<File> directory, Runnable reindex, Executor writer) {
        this.directory = directory;
        this.reindex = reindex;
        this.writer = writer;
    }

    public static IconUpload get() {
        return INSTANCE;
    }

    /**
     * Starts an upload for {@code uploader}; {@code replies} later receives the outcome. Returns {@code null}
     * once started, or why it can't start.
     */
    public synchronized String begin(String uploader, Consumer<String> replies) {
        if (active != null) {
            return active.uploader.equals(uploader) ? "Your previous icon upload is still running."
                : "Another player is uploading icons right now.";
        }
        File live = directory.get();
        if (live == null) {
            return "The server isn't ready to receive icons yet.";
        }
        Session session = new Session(uploader, replies, live);
        active = session;
        writer.execute(() -> {
            try {
                deleteRecursively(session.staging);
                Files.createDirectories(session.staging.toPath());
            } catch (IOException e) {
                session.failure = e;
            }
        });
        return null;
    }

    /** Stages one icon of {@code uploader}'s upload. Invalid icons are counted and dropped, never fatal. */
    public synchronized void accept(String uploader, String itemid, byte[] png) {
        Session session = active;
        if (session == null || !session.uploader.equals(uploader)) {
            return;
        }
        if (itemid == null || !itemid.equals(IconFileNames.itemId(IconFileNames.fileName(itemid)))
            || !isPng(png)
            || png.length > MAX_ICON_BYTES
            || session.bytes + png.length > MAX_UPLOAD_BYTES) {
            session.rejected++;
            return;
        }
        session.bytes += png.length;
        writer.execute(() -> {
            if (session.failure != null) return;
            try {
                Files.write(new File(session.staging, IconFileNames.fileName(itemid)).toPath(), png);
                session.stored++;
            } catch (IOException e) {
                session.failure = e;
            }
        });
    }

    /** Installs {@code uploader}'s staged icons in place of the current ones and reports the result. */
    public synchronized void finish(String uploader) {
        Session session = active;
        if (session == null || !session.uploader.equals(uploader)) {
            return;
        }
        active = null;
        writer.execute(() -> session.reply(commit(session)));
    }

    /** Drops {@code uploader}'s upload (e.g. they disconnected); the current icons stay as they are. */
    public synchronized void abort(String uploader) {
        Session session = active;
        if (session == null || !session.uploader.equals(uploader)) {
            return;
        }
        active = null;
        writer.execute(() -> discard(session));
    }

    private String commit(Session session) {
        if (session.failure != null) {
            LOG.warn("Icon upload failed", session.failure);
            discard(session);
            return "Icon upload failed on the server: " + session.failure.getMessage();
        }
        if (session.stored == 0) {
            discard(session);
            return "No valid icons were received (" + session.rejected + " rejected); the current icons stay.";
        }
        File old = sibling(session.live, ".old");
        try {
            deleteRecursively(old);
            if (session.live.exists()) {
                Files.move(session.live.toPath(), old.toPath());
            }
            Files.move(session.staging.toPath(), session.live.toPath());
        } catch (IOException e) {
            LOG.warn("Installing uploaded icons failed", e);
            return "Installing the icons failed on the server: " + e.getMessage();
        }
        reindex.run();
        try {
            deleteRecursively(old);
        } catch (IOException e) {
            LOG.warn("Couldn't delete the previous icons in {}", old, e);
        }
        LOG.info(
            "Installed {} uploaded icons ({} rejected) from {}",
            session.stored,
            session.rejected,
            session.uploader);
        return "Installed " + session.stored
            + " icons on the server"
            + (session.rejected > 0 ? " (" + session.rejected + " rejected)" : "")
            + ".";
    }

    private static void discard(Session session) {
        try {
            deleteRecursively(session.staging);
        } catch (IOException e) {
            LOG.warn("Couldn't delete the icon upload staging directory {}", session.staging, e);
        }
    }

    private static boolean isPng(byte[] data) {
        if (data == null || data.length < PNG_SIGNATURE.length) return false;
        for (int i = 0; i < PNG_SIGNATURE.length; i++) {
            if (data[i] != PNG_SIGNATURE[i]) return false;
        }
        return true;
    }

    private static File sibling(File directory, String suffix) {
        return new File(directory.getParentFile(), directory.getName() + suffix);
    }

    private static void deleteRecursively(File directory) throws IOException {
        if (!directory.exists()) return;
        try (Stream<Path> paths = Files.walk(directory.toPath())) {
            for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) {
                Files.delete(path);
            }
        }
    }

    private static final class Session {

        final String uploader;
        final Consumer<String> replies;
        final File live;
        final File staging;
        /** Guarded by the IconUpload monitor. */
        long bytes;
        /** Guarded by the IconUpload monitor. */
        int rejected;
        /** Written by the writer thread only. */
        int stored;
        /** Written by the writer thread only. */
        IOException failure;

        Session(String uploader, Consumer<String> replies, File live) {
            this.uploader = uploader;
            this.replies = replies;
            this.live = live;
            this.staging = sibling(live, ".uploading");
        }

        void reply(String message) {
            try {
                replies.accept(message);
            } catch (RuntimeException e) {
                LOG.warn("Couldn't report the icon upload result to {}", uploader, e);
            }
        }
    }
}
