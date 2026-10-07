package pl.kuba6000.ae2webintegration.core.gt;

import java.io.File;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.google.common.io.Files;

import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

/**
 * One GregTech data file next to {@code griddata.json}, with the same write discipline as
 * {@code ItemHistoryStore}: periodic writes go to a background thread, at most one in flight, and a newer
 * snapshot supersedes a queued one; shutdown writes synchronously. All files share one writer thread.
 */
final class GTJsonFile<T> {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");

    private static volatile ExecutorService writer;

    private final String fileName;
    private final Class<T> type;
    private final AtomicReference<T> pendingWrite = new AtomicReference<>();
    private final AtomicBoolean writeInFlight = new AtomicBoolean(false);

    GTJsonFile(String fileName, Class<T> type) {
        this.fileName = fileName;
        this.type = type;
    }

    File file() {
        return Config.getConfigFile(fileName);
    }

    /** {@code null} when there is no config directory, no file, or the file cannot be read. */
    T load() {
        if (Config.getConfigDirectory() == null) {
            return null;
        }
        File file = file();
        if (!file.exists()) {
            return null;
        }
        try (Reader reader = Files.newReader(file, StandardCharsets.UTF_8)) {
            T loaded = GSONUtils.GSON_BUILDER.create()
                .fromJson(reader, type);
            if (loaded == null) {
                LOG.error("GregTech data file " + fileName + " is empty or malformed, starting empty.");
            }
            return loaded;
        } catch (Exception e) {
            // As in ItemHistoryStore: a failed read must not overwrite the file it failed on - but the next
            // save will, so say clearly that this is the moment to keep a copy.
            LOG.error("Failed to load GregTech data from " + file.getAbsolutePath() + ", starting empty", e);
            return null;
        }
    }

    void saveNow(T snapshot) {
        if (Config.getConfigDirectory() == null) {
            return;
        }
        pendingWrite.set(null);
        write(snapshot);
    }

    void saveAsync(T snapshot) {
        if (Config.getConfigDirectory() == null) {
            return;
        }
        pendingWrite.set(snapshot);
        if (writeInFlight.compareAndSet(false, true)) {
            writer().submit(this::drainWrites);
        }
    }

    private void drainWrites() {
        T toWrite;
        while ((toWrite = pendingWrite.getAndSet(null)) != null) {
            write(toWrite);
        }
        writeInFlight.set(false);
        // A write could have been queued between the loop's last check and the flag reset above.
        if (pendingWrite.get() != null && writeInFlight.compareAndSet(false, true)) {
            writer().submit(this::drainWrites);
        }
    }

    private void write(T snapshot) {
        try {
            GSONUtils.writeAtomically(file(), snapshot);
        } catch (Exception e) {
            LOG.error("Failed to save GregTech data to " + fileName, e);
        }
    }

    private static ExecutorService writer() {
        ExecutorService current = writer;
        if (current == null) {
            synchronized (GTJsonFile.class) {
                current = writer;
                if (current == null) {
                    current = Executors.newSingleThreadExecutor(r -> {
                        Thread thread = new Thread(r, "ae2webintegration-gt-writer");
                        thread.setDaemon(true);
                        return thread;
                    });
                    writer = current;
                }
            }
        }
        return current;
    }
}
