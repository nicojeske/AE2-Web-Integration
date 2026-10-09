package pl.kuba6000.ae2webintegration.ae2interface.proxy;

import net.minecraftforge.client.ClientCommandHandler;

import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.event.FMLInitializationEvent;
import pl.kuba6000.ae2webintegration.ae2interface.client.IconExportCommand;
import pl.kuba6000.ae2webintegration.ae2interface.client.IconExporter;
import pl.kuba6000.ae2webintegration.ae2interface.network.IconUploadHandlers;

public class ClientProxy extends CommonProxy {

    @Override
    public void init(FMLInitializationEvent event) {
        super.init(event);
        ClientCommandHandler.instance.registerCommand(new IconExportCommand());
        IconUploadHandlers.clientStatusListener = IconExporter::onStatus;
        FMLCommonHandler.instance()
            .bus()
            .register(new IconExporter.RenderHook());
    }
}
