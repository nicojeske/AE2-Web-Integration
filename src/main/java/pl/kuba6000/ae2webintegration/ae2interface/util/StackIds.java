package pl.kuba6000.ae2webintegration.ae2interface.util;

import net.minecraft.item.Item;
import net.minecraftforge.fluids.Fluid;

import cpw.mods.fml.common.registry.GameData;

/**
 * The item and fluid ID format the web side keys everything on ({@code modid:name:damage} for items, the fluid
 * registry name for fluids). Shared by the AE2 stack mixin and the GregTech adapter so both produce the same keys.
 */
public final class StackIds {

    private StackIds() {}

    public static String itemId(Item item, int damage) {
        return GameData.getItemRegistry()
            .getNameForObject(item) + ":"
            + damage;
    }

    public static String fluidId(Fluid fluid) {
        return fluid.getName();
    }
}
