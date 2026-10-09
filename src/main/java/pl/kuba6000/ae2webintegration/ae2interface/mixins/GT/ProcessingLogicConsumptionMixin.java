package pl.kuba6000.ae2webintegration.ae2interface.mixins.GT;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import gregtech.api.interfaces.tileentity.IVoidable;
import gregtech.api.logic.ProcessingLogic;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import gregtech.api.recipe.check.CheckRecipeResult;
import gregtech.api.util.GTRecipe;
import gregtech.api.util.OverclockCalculator;
import gregtech.api.util.ParallelHelper;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTProductionHook;

/**
 * Records the inputs of every recipe a multiblock starts through {@link ProcessingLogic}. By the time
 * {@code applyRecipe} returns, {@code ParallelHelper} has consumed them and {@code calculatedParallels} holds the
 * parallels including batch mode. Multiblocks with their own recipe check (TecTech EM and older overrides)
 * never get here and log outputs only.
 */
@Mixin(value = ProcessingLogic.class, remap = false)
public abstract class ProcessingLogicConsumptionMixin {

    @Shadow
    protected IVoidable machine;

    @Shadow
    protected int calculatedParallels;

    @Inject(method = "applyRecipe", at = @At("RETURN"))
    private void ae2web$recordInputs(GTRecipe recipe, ParallelHelper helper, OverclockCalculator calculator,
        CheckRecipeResult result, CallbackInfoReturnable<CheckRecipeResult> cir) {
        CheckRecipeResult applied = cir.getReturnValue();
        if (recipe == null || applied == null || !applied.wasSuccessful()) return;
        if (!(machine instanceof MTEMultiBlockBase)) return;
        GTProductionHook
            .recordInputs((MTEMultiBlockBase) machine, recipe.mInputs, recipe.mFluidInputs, calculatedParallels);
    }
}
