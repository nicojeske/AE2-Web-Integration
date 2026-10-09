package pl.kuba6000.ae2webintegration.core.interfaces;

public interface IAECraftingPatternDetails {

    IAEGenericStack[] web$getCondensedOutputs();

    /** Resources one push of this pattern takes from the crafting CPU, merged per resource. */
    IAEGenericStack[] web$getCondensedInputs();

}
