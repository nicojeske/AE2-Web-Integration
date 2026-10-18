package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.ArrayList;
import java.util.List;

import org.jetbrains.annotations.NotNull;

import pl.kuba6000.ae2webintegration.core.grid.CraftingPlanRegistry;
import pl.kuba6000.ae2webintegration.core.history.HistoryDb;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingPlanSummary;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingPlanSummaryEntry;
import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

/**
 * Records crafting plans that came back with missing ingredients, so the Bottlenecks page can rank what blocks
 * crafting most often. Called on the server thread, once per plan; without a history database it does nothing.
 */
public final class CraftShortfallLog {

    private CraftShortfallLog() {}

    /** One missing ingredient, as stored in {@code ae2wi_craft_shortfall.missing}. */
    @SuppressWarnings("unused") // Gson reads the fields reflectively.
    private static final class Missing {

        final String itemid;
        final String name;
        final long amount;

        Missing(String itemid, String name, long amount) {
            this.itemid = itemid;
            this.name = name;
            this.amount = amount;
        }
    }

    public static void record(@NotNull StableKey gridKey, @NotNull CraftingPlanRegistry.Request request,
        @NotNull ICraftingPlanSummary summary, long nowMillis) {
        HistoryDb db = HistoryDb.get();
        if (db == null) return;
        List<Missing> missing = new ArrayList<>();
        for (ICraftingPlanSummaryEntry entry : summary.web$getEntries()) {
            long amount = entry.web$getMissingAmount();
            if (amount <= 0) continue;
            missing.add(
                new Missing(
                    entry.web$getWhat()
                        .web$getItemID(),
                    entry.web$getWhat()
                        .web$getDisplayName(),
                    amount));
        }
        if (missing.isEmpty()) return;
        db.putCraftShortfall(
            gridKey.toString(),
            nowMillis,
            request,
            GSONUtils.GSON_BUILDER.create()
                .toJson(missing));
    }
}
