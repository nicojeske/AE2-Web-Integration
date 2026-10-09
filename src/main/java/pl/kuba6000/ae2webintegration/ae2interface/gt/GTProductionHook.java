package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.WeakHashMap;

import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import pl.kuba6000.ae2webintegration.ae2interface.AE2WebIntegration;
import pl.kuba6000.ae2webintegration.core.api.IAEWebInterface;
import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTStack;

/** Called from the GregTech mixins on the server thread. Never throws into GregTech's tick. */
public final class GTProductionHook {

    private static final Set<Class<?>> failedTypes = Collections.newSetFromMap(new HashMap<>());
    /** Inputs of the recipe each machine last started, for the scan to show beside its outputs. */
    private static final Map<MTEMultiBlockBase, List<GTStack>> currentInputs = Collections
        .synchronizedMap(new WeakHashMap<>());

    private GTProductionHook() {}

    /** One finished recipe's outputs, just before the machine clears them. */
    public static void record(MTEMultiBlockBase mte, ItemStack[] items, FluidStack[] fluids) {
        if (items == null && fluids == null) return;
        try {
            IGregTechTileEntity base = mte.getBaseMetaTileEntity();
            if (base == null || base.getWorld() == null || base.getWorld().isRemote) return;
            String id = idOf(base);
            String name = mte.getLocalName();
            UUID owner = base.getOwnerUuid();
            IAEWebInterface web = IAEWebInterface.getInstance();
            record(web, id, name, owner, items);
            record(web, id, name, owner, fluids);
        } catch (Throwable t) {
            if (failedTypes.add(mte.getClass())) {
                AE2WebIntegration.LOG.warn("Not recording GregTech production of {}", mte.getClass(), t);
            }
        }
    }

    /**
     * The inputs a recipe took as it started: {@code recipe} inputs times its parallels (batch mode included).
     * Stacks of size zero are non-consumed circuits and catalysts and are skipped.
     */
    public static void recordInputs(MTEMultiBlockBase mte, ItemStack[] items, FluidStack[] fluids, int parallel) {
        if ((items == null && fluids == null) || parallel <= 0) return;
        try {
            IGregTechTileEntity base = mte.getBaseMetaTileEntity();
            if (base == null || base.getWorld() == null || base.getWorld().isRemote) return;
            String id = idOf(base);
            String name = mte.getLocalName();
            UUID owner = base.getOwnerUuid();
            IAEWebInterface web = IAEWebInterface.getInstance();
            List<GTStack> stacks = new ArrayList<>();
            GTStacks.addAll(items, fluids, stacks);
            // A recipe may list the same item twice; show and log it once, times the parallels.
            Map<String, GTStack> merged = new LinkedHashMap<>();
            for (GTStack stack : stacks) {
                GTStack total = merged
                    .computeIfAbsent(stack.id, k -> new GTStack(stack.id, stack.name, 0, stack.fluid));
                total.amount += stack.amount * parallel;
            }
            currentInputs.put(mte, new ArrayList<>(merged.values()));
            for (GTStack total : merged.values()) {
                web.recordGTProduction(
                    id,
                    name,
                    owner,
                    total.id,
                    total.name,
                    total.amount,
                    total.fluid,
                    GTFlow.CONSUMED);
            }
        } catch (Throwable t) {
            if (failedTypes.add(mte.getClass())) {
                AE2WebIntegration.LOG.warn("Not recording GregTech inputs of {}", mte.getClass(), t);
            }
        }
    }

    private static void record(IAEWebInterface web, String id, String name, UUID owner, ItemStack[] stacks) {
        if (stacks == null) return;
        for (ItemStack s : stacks) emit(web, id, name, owner, GTStacks.of(s));
    }

    private static void record(IAEWebInterface web, String id, String name, UUID owner, FluidStack[] stacks) {
        if (stacks == null) return;
        for (FluidStack s : stacks) emit(web, id, name, owner, GTStacks.of(s));
    }

    private static void emit(IAEWebInterface web, String id, String name, UUID owner, GTStack s) {
        if (s != null) web.recordGTProduction(id, name, owner, s.id, s.name, s.amount, s.fluid, GTFlow.PRODUCED);
    }

    /** Inputs of the recipe {@code mte} last started; empty if none was seen since the server started. */
    public static List<GTStack> currentInputs(MTEMultiBlockBase mte) {
        List<GTStack> inputs = currentInputs.get(mte);
        return inputs == null ? Collections.emptyList() : inputs;
    }

    /** The controller was broken: forget it now rather than letting it expire. */
    public static void removed(MTEMultiBlockBase mte) {
        try {
            IGregTechTileEntity base = mte.getBaseMetaTileEntity();
            if (base == null || base.getWorld() == null || base.getWorld().isRemote) return;
            IAEWebInterface.getInstance()
                .gtMachineRemoved(idOf(base));
        } catch (Throwable t) {
            if (failedTypes.add(mte.getClass())) {
                AE2WebIntegration.LOG.warn("Not tracking removal of {}", mte.getClass(), t);
            }
        }
    }

    private static String idOf(IGregTechTileEntity base) {
        return GTMachineSnapshot
            .idOf(base.getWorld().provider.dimensionId, base.getXCoord(), base.getYCoord(), base.getZCoord());
    }
}
