package pl.kuba6000.ae2webintegration.ae2interface.network;

import cpw.mods.fml.common.network.NetworkRegistry;
import cpw.mods.fml.common.network.simpleimpl.SimpleNetworkWrapper;
import cpw.mods.fml.relauncher.Side;
import pl.kuba6000.ae2webintegration.ae2interface.AE2WebIntegration;

/** The mod's own client/server channel; today it only carries icon uploads (see {@link IconUploadHandlers}). */
public final class AE2WebNetwork {

    public static final SimpleNetworkWrapper CHANNEL = NetworkRegistry.INSTANCE
        .newSimpleChannel(AE2WebIntegration.MODID);

    private AE2WebNetwork() {}

    /** Registers every message on both sides; call once from preInit. */
    public static void init() {
        CHANNEL.registerMessage(IconUploadHandlers.BeginHandler.class, IconUploadMessages.Begin.class, 0, Side.SERVER);
        CHANNEL.registerMessage(IconUploadHandlers.ChunkHandler.class, IconUploadMessages.Chunk.class, 1, Side.SERVER);
        CHANNEL.registerMessage(IconUploadHandlers.EndHandler.class, IconUploadMessages.End.class, 2, Side.SERVER);
        CHANNEL
            .registerMessage(IconUploadHandlers.StatusHandler.class, IconUploadMessages.Status.class, 3, Side.CLIENT);
    }
}
