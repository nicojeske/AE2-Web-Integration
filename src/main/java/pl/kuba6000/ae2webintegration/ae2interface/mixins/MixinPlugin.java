package pl.kuba6000.ae2webintegration.ae2interface.mixins;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.spongepowered.asm.lib.tree.ClassNode;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;

@SuppressWarnings("unused")
public class MixinPlugin implements IMixinConfigPlugin {

    private static final Logger LOG = LogManager.getLogger("AE2WebIntegration mixins");

    @Override
    public void onLoad(String mixinPackage) {

    }

    @Override
    public String getRefMapperConfig() {
        return null;
    }

    @Override
    public boolean shouldApplyMixin(String targetClassName, String mixinClassName) {
        return true;
    }

    @Override
    public void acceptTargets(Set<String> myTargets, Set<String> otherTargets) {

    }

    @Override
    public List<String> getMixins() {

        List<String> mixins = new ArrayList<>(
            Arrays.asList(
                "AE2.CraftingGridCacheMixin",
                "AE2.ControllerRemovalMixin",
                "AE2.GridNodeTopologyMixin",
                "AE2.SecurityCacheMixin",
                "AE2.CraftingCPUClusterMixin",
                "AE2.implementations.AEStackMixin",
                "AE2.implementations.AEItemListMixin",
                "AE2.implementations.AECraftingCPUClusterMixin",
                "AE2.implementations.AECraftingJobMixin",
                "AE2.implementations.AECraftingPatternDetailsMixin",
                "AE2.implementations.AEGridMixin",
                "AE2.implementations.AEMeInventoryItemMixin",
                "AE2.implementations.AEPlayerDataMixin",
                "AE2.implementations.PatternProviderViewableMixin",
                "AE2.implementations.service.AECraftingGridMixin",
                "AE2.implementations.service.AEPathingGridMixin",
                "AE2.implementations.service.AEStorageGridMixin"));

        LOG.info("MIXING INTO AE2 LETS GOOOOOOOOOOOOOOOOOOOOOOOOO");

        // GregTech is optional. Its jar is an FML coremod, so like AE2 it is already on the launch classpath here,
        // but mod discovery has not run yet: look for the classes rather than asking Loader.
        if (hasClass("gregtech/api/metatileentity/implementations/MTEMultiBlockBase.class")) {
            mixins.add("GT.MTEMultiBlockBaseProductionMixin");
            if (hasClass("gregtech/api/logic/ProcessingLogic.class")) {
                mixins.add("GT.ProcessingLogicConsumptionMixin");
            }
            if (hasClass("tectech/thing/metaTileEntity/multi/base/TTMultiblockBase.class")) {
                mixins.add("GT.TTMultiblockBaseProductionMixin");
            }
            LOG.info("GregTech found, adding production mixins");
        }

        return mixins;
    }

    private static boolean hasClass(String resource) {
        return MixinPlugin.class.getClassLoader()
            .getResource(resource) != null;
    }

    @Override
    public void preApply(String s, ClassNode classNode, String s1, IMixinInfo iMixinInfo) {

    }

    @Override
    public void postApply(String s, ClassNode classNode, String s1, IMixinInfo iMixinInfo) {

    }
}
