package pl.kuba6000.ae2webintegration.ae2interface.mixins.GT;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTProductionHook;
import tectech.thing.metaTileEntity.multi.base.TTMultiblockBase;

/** TecTech multiblocks run their own tick loop instead of {@code runMachine}; they emit outputs here. */
@Mixin(value = TTMultiblockBase.class, remap = false)
public abstract class TTMultiblockBaseProductionMixin {

    @Inject(method = "addClassicOutputs_EM", at = @At("HEAD"), require = 0)
    private void ae2web$recordOutputs(CallbackInfo ci) {
        MTEMultiBlockBase self = (MTEMultiBlockBase) (Object) this;
        GTProductionHook.record(self, self.mOutputItems, self.mOutputFluids);
    }
}
