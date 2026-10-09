package pl.kuba6000.ae2webintegration.core.api;

import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingPatternDetails;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.IPatternProviderViewable;
import pl.kuba6000.ae2webintegration.core.tracking.AEMixinCallbacks;

public interface IAEMixinCallbacks {

    static IAEMixinCallbacks getInstance() {
        return AEMixinCallbacks.INSTANCE;
    }

    /**
     * @param requester the requesting player's name when the platform knows it; null for a machine, or for
     *                  the web integration's own submissions (the web user is attached by core)
     */
    void jobStarted(ICraftingCPUCluster cpuCluster, IAEGrid grid, boolean isMerging, boolean isAuthorPlayer,
        @Nullable String requester);

    void craftingStatusPostedUpdate(ICraftingCPUCluster cpu, Object diff);

    void pushedPattern(ICraftingCPUCluster cpu, IPatternProviderViewable provider, IAECraftingPatternDetails details);

    void jobCompleted(IAEGrid grid, ICraftingCPUCluster cpu);

    void jobCancelled(IAEGrid grid, ICraftingCPUCluster cpu);

}
