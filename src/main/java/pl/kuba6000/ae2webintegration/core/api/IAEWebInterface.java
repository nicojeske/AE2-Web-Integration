package pl.kuba6000.ae2webintegration.core.api;

import java.util.UUID;

import pl.kuba6000.ae2webintegration.core.AEWebAPI;
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
     * leaves every {@code /gt/*} endpoint answering {@code NOT_AVAILABLE}.
     */
    void registerGTProvider(IGTProvider provider);

    /**
     * Records the outputs of one finished GregTech recipe. Called on the server thread, from the hook where a
     * multiblock emits its outputs, so it must be (and is) cheap: one map update per output stack.
     *
     * @param machineId   {@code GTMachineSnapshot.idOf(dim, x, y, z)} of the controller
     * @param machineName localized machine name, kept for display after the machine unloads
     * @param owner       machine owner, for visibility; may be {@code null} (then only admins see it)
     * @param stackId     same format as {@code GTStack.id}
     * @param amount      items, or millibuckets for a fluid; non-positive amounts are ignored
     */
    void recordGTProduction(String machineId, String machineName, UUID owner, String stackId, String stackName,
        long amount, boolean fluid);

    /** Forgets a machine right away, e.g. when its controller is broken, instead of waiting for it to expire. */
    void gtMachineRemoved(String machineId);

}
