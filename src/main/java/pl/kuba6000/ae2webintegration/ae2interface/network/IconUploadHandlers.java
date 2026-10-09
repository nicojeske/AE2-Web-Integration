package pl.kuba6000.ae2webintegration.ae2interface.network;

import java.util.function.Consumer;

import net.minecraft.entity.player.EntityPlayerMP;

import cpw.mods.fml.common.network.simpleimpl.IMessage;
import cpw.mods.fml.common.network.simpleimpl.IMessageHandler;
import cpw.mods.fml.common.network.simpleimpl.MessageContext;
import pl.kuba6000.ae2webintegration.ae2interface.network.IconUploadMessages.Status;
import pl.kuba6000.ae2webintegration.core.commands.CommandBootstrap;
import pl.kuba6000.ae2webintegration.core.icons.IconUpload;

/**
 * Handlers for {@link IconUploadMessages}. The server side hands everything to core's {@link IconUpload}, keyed by
 * the sender's UUID; in 1.7.10 these run on the network thread, which is fine since IconUpload never blocks on disk.
 */
public final class IconUploadHandlers {

    /** Set by the client proxy; kept as a hook so this class never references client-only code. */
    public static volatile Consumer<Status> clientStatusListener = status -> {};

    private IconUploadHandlers() {}

    private static String uploader(EntityPlayerMP player) {
        return player.getUniqueID()
            .toString();
    }

    public static final class BeginHandler implements IMessageHandler<IconUploadMessages.Begin, IMessage> {

        @Override
        public IMessage onMessage(IconUploadMessages.Begin message, MessageContext ctx) {
            EntityPlayerMP player = ctx.getServerHandler().playerEntity;
            if (!player.canCommandSenderUseCommand(CommandBootstrap.ADMIN_PERMISSION_LEVEL, "ae2webicons")) {
                return new Status(Status.Kind.REJECTED, "Only server operators can upload icons.");
            }
            String error = IconUpload.get()
                .begin(uploader(player), result -> {
                    if (player.playerNetServerHandler != null) {
                        AE2WebNetwork.CHANNEL.sendTo(new Status(Status.Kind.RESULT, result), player);
                    }
                });
            return error == null ? new Status(Status.Kind.ACCEPTED, "") : new Status(Status.Kind.REJECTED, error);
        }
    }

    public static final class ChunkHandler implements IMessageHandler<IconUploadMessages.Chunk, IMessage> {

        @Override
        public IMessage onMessage(IconUploadMessages.Chunk message, MessageContext ctx) {
            String uploader = uploader(ctx.getServerHandler().playerEntity);
            for (int i = 0; i < message.itemids.size(); i++) {
                IconUpload.get()
                    .accept(uploader, message.itemids.get(i), message.pngs.get(i));
            }
            return null;
        }
    }

    public static final class EndHandler implements IMessageHandler<IconUploadMessages.End, IMessage> {

        @Override
        public IMessage onMessage(IconUploadMessages.End message, MessageContext ctx) {
            IconUpload.get()
                .finish(uploader(ctx.getServerHandler().playerEntity));
            return null;
        }
    }

    public static final class StatusHandler implements IMessageHandler<IconUploadMessages.Status, IMessage> {

        @Override
        public IMessage onMessage(IconUploadMessages.Status message, MessageContext ctx) {
            clientStatusListener.accept(message);
            return null;
        }
    }
}
