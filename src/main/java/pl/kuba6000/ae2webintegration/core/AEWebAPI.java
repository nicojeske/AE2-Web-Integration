package pl.kuba6000.ae2webintegration.core;

import java.util.UUID;

import pl.kuba6000.ae2webintegration.core.api.IAEWebInterface;
import pl.kuba6000.ae2webintegration.core.api.gt.GTFlow;
import pl.kuba6000.ae2webintegration.core.api.gt.IGTProvider;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTProductionLog;
import pl.kuba6000.ae2webintegration.core.interfaces.IAE;

public class AEWebAPI implements IAEWebInterface {

    public static final AEWebAPI INSTANCE = new AEWebAPI();

    @Override
    public UUID getAEWebUUID() {
        return AE2Controller.AEControllerUUID;
    }

    @Override
    public void initAEInterface(IAE ae) {
        AE2Controller.AE2Interface = ae;
    }

    @Override
    public void registerGTProvider(IGTProvider provider) {
        GTEngine.registerProvider(provider);
    }

    @Override
    public void recordGTProduction(String machineId, String machineName, UUID owner, String stackId, String stackName,
        long amount, boolean fluid, GTFlow flow) {
        GTProductionLog
            .record(flow, machineId, machineName, owner, stackId, stackName, amount, fluid, System.currentTimeMillis());
    }

    @Override
    public void gtMachineRemoved(String machineId) {
        GTMachineRegistry.remove(machineId);
    }
}
