package pl.kuba6000.ae2webintegration.core.http.endpoint.gt;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;

/**
 * Base for the {@code /api/gt/*} endpoints. Async on purpose: they only read what {@code GTEngine} stored on the
 * last scan, never live GregTech state. Not grid-scoped - visibility is per machine owner instead
 * ({@link GTVisibility}) - so they have no {@code gridKey}.
 */
public abstract class GTRequest extends IAsyncRequest {

    static final int DEFAULT_POINTS = 120;
    static final int MAX_POINTS = 500;

    @Override
    public final void handle() {
        if (!GTEngine.isAvailable()) {
            deny(ApiStatus.NOT_AVAILABLE);
            return;
        }
        handleGT(context.getPrincipal());
    }

    protected abstract void handleGT(WebPrincipal principal);

    static Predicate<UUID> visibleTo(WebPrincipal principal) {
        return owner -> GTVisibility.canSee(principal, owner);
    }

    /**
     * {@code range} as milliseconds, or {@code null} for a bad value. Accepts the presets below, or
     * {@code custom} with {@code minutes}. Clamped to {@code maxMillis}.
     */
    static Long parseRange(String range, Integer minutes, long maxMillis) {
        long millis;
        switch (range) {
            case "15m":
                millis = TimeUnit.MINUTES.toMillis(15);
                break;
            case "1h":
                millis = TimeUnit.HOURS.toMillis(1);
                break;
            case "6h":
                millis = TimeUnit.HOURS.toMillis(6);
                break;
            case "24h":
                millis = TimeUnit.HOURS.toMillis(24);
                break;
            case "7d":
                millis = TimeUnit.DAYS.toMillis(7);
                break;
            case "30d":
                millis = TimeUnit.DAYS.toMillis(30);
                break;
            case "90d":
                millis = TimeUnit.DAYS.toMillis(90);
                break;
            case "all":
                millis = maxMillis;
                break;
            case "custom":
                if (minutes == null || minutes < 1) {
                    return null;
                }
                millis = TimeUnit.MINUTES.toMillis(minutes);
                break;
            default:
                return null;
        }
        return Math.min(millis, maxMillis);
    }

    /** {@code points} clamped to {@code [1, MAX_POINTS]}, {@code null} when below 1. */
    static Integer parsePoints(int points) {
        return points < 1 ? null : Math.min(points, MAX_POINTS);
    }
}
