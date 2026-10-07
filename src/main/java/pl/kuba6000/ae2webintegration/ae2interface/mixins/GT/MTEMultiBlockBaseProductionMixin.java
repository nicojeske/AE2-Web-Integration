package pl.kuba6000.ae2webintegration.ae2interface.mixins.GT;

import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

import org.spongepowered.asm.lib.Opcodes;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTProductionHook;

/**
 * Records each finished recipe of every multiblock whose {@code runMachine} reaches the base implementation
 * (MTEMultiBlockBase, the extended-power base, GT++, bartworks and the overrides that call super).
 */
@Mixin(value = MTEMultiBlockBase.class, remap = false)
public abstract class MTEMultiBlockBaseProductionMixin {

    @Shadow
    public ItemStack[] mOutputItems;

    @Shadow
    public FluidStack[] mOutputFluids;

    /** Right before {@code mOutputItems = null} in the completion branch, while both arrays are still filled. */
    @Inject(
        method = "runMachine",
        at = @At(
            value = "FIELD",
            target = "Lgregtech/api/metatileentity/implementations/MTEMultiBlockBase;mOutputItems:[Lnet/minecraft/item/ItemStack;",
            opcode = Opcodes.PUTFIELD,
            ordinal = 0))
    private void ae2web$recordOutputs(IGregTechTileEntity base, long tick, CallbackInfo ci) {
        GTProductionHook.record((MTEMultiBlockBase) (Object) this, mOutputItems, mOutputFluids);
    }

    @Inject(method = "onRemoval", at = @At("HEAD"))
    private void ae2web$removed(CallbackInfo ci) {
        GTProductionHook.removed((MTEMultiBlockBase) (Object) this);
    }
}
