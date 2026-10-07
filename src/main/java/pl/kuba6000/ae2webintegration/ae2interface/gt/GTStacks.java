package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.util.List;

import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

import pl.kuba6000.ae2webintegration.ae2interface.util.StackIds;
import pl.kuba6000.ae2webintegration.core.api.gt.GTStack;

/** Converts GregTech's item and fluid stacks into core {@link GTStack}s, keyed like the AE2 side. */
public final class GTStacks {

    private GTStacks() {}

    /** @return {@code null} for an empty or broken stack */
    public static GTStack of(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) return null;
        return new GTStack(
            StackIds.itemId(stack.getItem(), stack.getItemDamage()),
            stack.getDisplayName(),
            stack.stackSize,
            false);
    }

    /** @return {@code null} for an empty or broken stack */
    public static GTStack of(FluidStack stack) {
        if (stack == null || stack.getFluid() == null || stack.amount <= 0) return null;
        return new GTStack(StackIds.fluidId(stack.getFluid()), stack.getLocalizedName(), stack.amount, true);
    }

    /** Adds every non-empty stack of both arrays (either may be {@code null}) to {@code out}. */
    public static void addAll(ItemStack[] items, FluidStack[] fluids, List<GTStack> out) {
        if (items != null) for (ItemStack s : items) {
            GTStack g = of(s);
            if (g != null) out.add(g);
        }
        if (fluids != null) for (FluidStack s : fluids) {
            GTStack g = of(s);
            if (g != null) out.add(g);
        }
    }
}
