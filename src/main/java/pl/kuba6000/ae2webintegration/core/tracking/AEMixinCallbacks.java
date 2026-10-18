package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.jetbrains.annotations.Nullable;

import pl.kuba6000.ae2webintegration.core.api.IAEMixinCallbacks;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingPatternDetails;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.IPatternProviderViewable;

/**
 * Called from inside AE2's own packet and tick handling: tracking is a side feature, so a failure here is logged
 * and swallowed instead of aborting the craft or disconnecting the player.
 */
public class AEMixinCallbacks implements IAEMixinCallbacks {

    private static final Logger LOG = LogManager.getLogger("ae2webintegration");
    private static final AtomicBoolean LOGGED_FAILURE = new AtomicBoolean();

    public static AEMixinCallbacks INSTANCE = new AEMixinCallbacks();

    @Override
    public void jobStarted(ICraftingCPUCluster cpuCluster, IAEGrid grid, boolean isMerging, boolean isAuthorPlayer,
        @Nullable String requester) {
        if (!Config.INSTANCE.tracking.trackMachineCrafting && !isAuthorPlayer) {
            return;
        }
        guard("jobStarted", () -> AE2JobTracker.addJob(cpuCluster, grid, isMerging, requester));
    }

    @Override
    public void craftingStatusPostedUpdate(ICraftingCPUCluster cpu, Object diff) {
        guard("craftingStatusPostedUpdate", () -> AE2JobTracker.updateCraftingStatus(cpu, diff));
    }

    @Override
    public void pushedPattern(ICraftingCPUCluster cpu, IPatternProviderViewable provider,
        IAECraftingPatternDetails details) {
        guard("pushedPattern", () -> AE2JobTracker.pushedPattern(cpu, provider, details));
    }

    @Override
    public void jobCompleted(IAEGrid grid, ICraftingCPUCluster cpu) {
        guard("jobCompleted", () -> AE2JobTracker.completeCrafting(grid, cpu));
    }

    @Override
    public void jobCancelled(IAEGrid grid, ICraftingCPUCluster cpu) {
        guard("jobCancelled", () -> AE2JobTracker.cancelCrafting(grid, cpu));
    }

    /** Logs the first failure with its stack trace, later ones without, so a per-tick hook can't flood the log. */
    private static void guard(String callback, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            if (LOGGED_FAILURE.compareAndSet(false, true)) LOG.warn("Crafting tracking failed in {}", callback, e);
            else LOG.debug("Crafting tracking failed in {}: {}", callback, e.toString());
        }
    }
}
