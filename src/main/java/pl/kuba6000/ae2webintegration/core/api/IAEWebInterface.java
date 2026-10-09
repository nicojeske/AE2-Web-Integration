package pl.kuba6000.ae2webintegration.core.api;

import java.util.UUID;

import pl.kuba6000.ae2webintegration.core.AEWebAPI;
import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.api.gt.IGTProvider;
import pl.kuba6000.ae2webintegration.core.interfaces.IAE;

public interface IAEWebInterface {

    static IAEWebInterface getInstance() {
        return AEWebAPI.INSTANCE;
    }

    UUID getAEWebUUID();

    void initAEInterface(IAE ae);

    /**
     * Enables the GregTech pages. Called once at mod init by a branch that has GregTech; never calling it
     * leaves every {@code /api/gt/*} endpoint answering {@code NOT_AVAILABLE}.
     */
    void registerGTProvider(IGTProvider provider);

    /**
     * Records one stack of a GregTech recipe: an output when the recipe finishes, or an input when it starts.
     * Called on the server thread from the multiblock hooks, so it must be (and is) cheap: one map update.
     *
     * @param machineId   {@code GTMachineSnapshot.idOf(dim, x, y, z)} of the controller
     * @param machineName localized machine name, kept for display after the machine unloads
     * @param owner       machine owner, for visibility; may be {@code null} (then only admins see it)
     * @param stackId     same format as {@code GTStack.id}
     * @param amount      items, or millibuckets for a fluid; non-positive amounts are ignored
     * @param flow        whether the stack was produced or consumed
     */
    void recordGTProduction(String machineId, String machineName, UUID owner, String stackId, String stackName,
        long amount, boolean fluid, GTFlow flow);

    /** Forgets a machine right away, e.g. when its controller is broken, instead of waiting for it to expire. */
    void gtMachineRemoved(String machineId);

}
