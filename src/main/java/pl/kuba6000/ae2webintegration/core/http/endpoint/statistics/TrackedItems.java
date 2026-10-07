package pl.kuba6000.ae2webintegration.core.http.endpoint.statistics;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.UnaryOperator;

import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.github.bsideup.jabel.Desugar;

import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.ae2request.async.IAsyncRequest;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.grid.GridSettingsData;
import pl.kuba6000.ae2webintegration.core.http.ApiStatus;
import pl.kuba6000.ae2webintegration.core.identity.GridIdentityRegistry;
import pl.kuba6000.ae2webintegration.core.tracking.ItemHistoryStore;

/** Shared read/edit logic of the tracked-items endpoints, which differ only in how they change the set. */
abstract class TrackedItems extends IAsyncRequest {

    static final int MAX_ITEMID_LENGTH = 256;

    /**
     * Successful operation result.
     *
     * @param status {@code OK} for a successful request
     * @param data   the grid's tracked items after any requested change
     * @example status OK
     */
    @Desugar
    public record Response(@NotNull ApiStatus status, @NotNull Result data) {}

    /**
     * Items a grid samples stored-count history for.
     *
     * @param tracked item ids in tracking order
     * @param limit   most items this grid may track
     * @param names   last observed display name per tracked item id, for items no longer in the network
     * @example limit 24
     * @keyExample names minecraft:iron_ingot:0
     */
    @Desugar
    public record Result(List<String> tracked, int limit, Map<String, String> names) {

        static Result of(GridSettingsData settings) {
            Set<String> tracked = settings.getTrackedItems();
            Map<String, String> known = settings.getTrackedItemNames();
            // Filtered to `tracked` so a stale name never leaks past its item being untracked.
            Map<String, String> names = new LinkedHashMap<>();
            for (String itemid : tracked) {
                String name = known.get(itemid);
                if (name != null) names.put(itemid, name);
            }
            return new Result(new ArrayList<>(tracked), Config.INSTANCE.statistics.maxTrackedItemsPerGrid, names);
        }
    }

    /**
     * Applies {@code edit} to the grid's tracked set (when non-null) and answers with the result. Edits run under
     * the registry monitor, like {@code PatchGridSettings}, so they serialize with other settings writes.
     */
    final void respondWith(@Nullable UnaryOperator<Set<String>> edit) {
        if (gridKey == null) {
            deny(ApiStatus.GRID_NOT_FOUND);
            return;
        }
        GridIdentityRegistry registry = CoreEngine.GRID_IDENTITIES;
        synchronized (registry) {
            GridPersistentData data = registry.getPersistentData(gridKey);
            if (data == null) {
                deny(ApiStatus.GRID_NOT_FOUND);
                return;
            }
            GridSettingsData settings = data.getSettings();
            if (edit != null) {
                Set<String> next = edit.apply(new LinkedHashSet<>(settings.getTrackedItems()));
                if (next == null) {
                    deny(ApiStatus.BAD_PARAM);
                    return;
                }
                if (next.size() > Config.INSTANCE.statistics.maxTrackedItemsPerGrid) {
                    deny(ApiStatus.TRACKED_LIMIT_REACHED);
                    return;
                }
                settings.setTrackedItems(next);
                try {
                    registry.saveIfDirty();
                } catch (IOException e) {
                    deny(ApiStatus.INTERNAL_ERROR);
                    return;
                }
                ItemHistoryStore.pruneTo(gridKey.toString(), settings.getTrackedItems());
            }
            respond(HttpURLConnection.HTTP_OK, new Response(ApiStatus.OK, Result.of(settings)));
        }
    }

    /** {@code null} when {@code itemid} is blank or too long. */
    static @Nullable String validItemId(@Nullable String itemid) {
        if (itemid == null) return null;
        String trimmed = itemid.trim();
        return trimmed.isEmpty() || trimmed.length() > MAX_ITEMID_LENGTH ? null : trimmed;
    }
}
