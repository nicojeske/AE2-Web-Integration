package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.util.List;
import java.util.function.Supplier;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;

import gregtech.api.GregTechAPI;
import gregtech.api.items.MetaGeneratedItem;

/**
 * GregTech's part of the icon exporter's item enumeration: GT keeps items out of {@code getSubItems} that exist
 * and can end up in an ME system (hot ingots and rings of some materials, ...). Call only when GregTech is loaded.
 */
public final class GTIconStacks {

    private GTIconStacks() {}

    /**
     * Runs {@code enumeration} with GT's "show all items in creative" switch on, which is what filters the
     * material items (gt.metaitem.01 and friends) out of {@code getSubItems}.
     */
    public static <T> T withAllItemsShown(Supplier<T> enumeration) {
        boolean previous = GregTechAPI.sDoShowAllItemsInCreative;
        GregTechAPI.sDoShowAllItemsInCreative = true;
        try {
            return enumeration.get();
        } finally {
            GregTechAPI.sDoShowAllItemsInCreative = previous;
        }
    }

    /**
     * Adds every enabled meta item of {@code item} - {@code getSubItems} only lists the visible ones, even with
     * the creative switch on.
     */
    public static void addEnabledMetaItems(Item item, List<ItemStack> out) {
        if (!(item instanceof MetaGeneratedItem metaItem)) return;
        for (int i = metaItem.mEnabledItems.nextSetBit(0); i >= 0; i = metaItem.mEnabledItems.nextSetBit(i + 1)) {
            out.add(new ItemStack(item, 1, metaItem.mOffset + i));
        }
    }
}
