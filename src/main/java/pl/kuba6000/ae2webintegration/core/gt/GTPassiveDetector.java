package pl.kuba6000.ae2webintegration.core.gt;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.config.Config;

/**
 * Suggests machines that look passive: ones that keep producing the same set of outputs (one recipe, or the
 * same few) around the clock. The web terminal offers them for the user to tuck away; nothing here hides
 * anything by itself.
 * <p>
 * The recent production history, {@code span} long, is cut into {@link #WINDOWS} equal windows; a machine is
 * a candidate when its set of output stacks is non-empty and identical in every window. {@code span} is how
 * long production has been tracked, clamped to {@link #MIN_SPAN_MILLIS}..{@link #MAX_SPAN_MILLIS} (and to the
 * hourly retention), so a fresh world gets suggestions after a day instead of three. Windows are whole hourly
 * buckets ending with the current one. Reads go through {@link GTProductionLog#totals},
 * so both history backends answer the same. The result is cached for {@link #CACHE_MILLIS}, since the
 * machines list it rides on is polled every few seconds.
 */
public final class GTPassiveDetector {

    static final int WINDOWS = 3;
    static final long MIN_SPAN_MILLIS = TimeUnit.DAYS.toMillis(1);
    static final long MAX_SPAN_MILLIS = TimeUnit.DAYS.toMillis(3);
    static final long CACHE_MILLIS = TimeUnit.MINUTES.toMillis(10);

    private GTPassiveDetector() {}

    private static final class Cached {

        final long computedAt;
        final Set<String> candidates;

        Cached(long computedAt, Set<String> candidates) {
            this.computedAt = computedAt;
            this.candidates = candidates;
        }
    }

    private static final Object LOCK = new Object();
    private static volatile Cached cached;

    /** Ids of every machine that looks passive as of {@code nowMillis}, regardless of who may see it. */
    public static Set<String> candidates(long nowMillis) {
        Cached current = cached;
        if (isFresh(current, nowMillis)) {
            return current.candidates;
        }
        synchronized (LOCK) {
            current = cached;
            if (!isFresh(current, nowMillis)) {
                current = new Cached(nowMillis, Collections.unmodifiableSet(compute(nowMillis)));
                cached = current;
            }
            return current.candidates;
        }
    }

    private static boolean isFresh(Cached c, long nowMillis) {
        return c != null && nowMillis >= c.computedAt && nowMillis - c.computedAt < CACHE_MILLIS;
    }

    static Set<String> compute(long nowMillis) {
        long since = GTProductionLog.trackingSinceMillis();
        if (since == 0L || nowMillis - since < MIN_SPAN_MILLIS) {
            return new HashSet<>();
        }
        // Whole hourly buckets, within hourly retention, so no bucket straddles two windows.
        long span = Math.min(
            Math.min(nowMillis - since, MAX_SPAN_MILLIS),
            TimeUnit.DAYS.toMillis(Config.INSTANCE.gregtech.productionHourlyRetentionDays));
        long windowHours = span / GTProductionLog.HOUR_MILLIS / WINDOWS;
        long lastBucket = Math.floorDiv(nowMillis, GTProductionLog.HOUR_MILLIS);
        long firstBucket = lastBucket - WINDOWS * windowHours + 1;

        Map<String, Set<String>> first = null;
        Set<String> candidates = null;
        for (int i = 0; i < WINDOWS; i++) {
            long from = (firstBucket + i * windowHours) * GTProductionLog.HOUR_MILLIS;
            long to = from + windowHours * GTProductionLog.HOUR_MILLIS - 1;
            Map<String, Set<String>> outputs = new HashMap<>();
            for (GTProductionLog.Row row : GTProductionLog
                .totals(GTFlow.PRODUCED, from, to, nowMillis, owner -> true, null)) {
                outputs.computeIfAbsent(row.machineId, k -> new HashSet<>())
                    .add(row.stackId);
            }
            if (first == null) {
                first = outputs;
                candidates = new HashSet<>(outputs.keySet());
            } else {
                Map<String, Set<String>> reference = first;
                candidates.removeIf(id -> !Objects.equals(reference.get(id), outputs.get(id)));
            }
        }
        return candidates;
    }

    static void clear() {
        cached = null;
    }
}
