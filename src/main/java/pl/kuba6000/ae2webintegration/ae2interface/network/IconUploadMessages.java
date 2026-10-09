package pl.kuba6000.ae2webintegration.ae2interface.network;

import java.util.ArrayList;
import java.util.List;

import cpw.mods.fml.common.network.ByteBufUtils;
import cpw.mods.fml.common.network.simpleimpl.IMessage;
import io.netty.buffer.ByteBuf;
import pl.kuba6000.ae2webintegration.core.icons.IconUpload;

/** Messages of an icon upload: Begin, any number of Chunks, End (client to server), Status (server to client). */
public final class IconUploadMessages {

    /**
     * Payload budget of one Chunk. A 1.7.10 client-to-server custom payload is capped at 32767 bytes; this leaves
     * room for the channel framing.
     */
    public static final int MAX_CHUNK_BYTES = 30000;

    private IconUploadMessages() {}

    /** Asks to start an upload; answered by an ACCEPTED or REJECTED {@link Status}. */
    public static final class Begin implements IMessage {

        @Override
        public void fromBytes(ByteBuf buf) {}

        @Override
        public void toBytes(ByteBuf buf) {}
    }

    /** A batch of encoded icons. */
    public static final class Chunk implements IMessage {

        public final List<String> itemids = new ArrayList<>();
        public final List<byte[]> pngs = new ArrayList<>();
        private int bytes;

        /** Bytes {@code add(itemid, png)} would take up on the wire, worst case. */
        public static int encodedSize(String itemid, byte[] png) {
            return 5 + itemid.length() * 3 + 5 + png.length;
        }

        public boolean fits(String itemid, byte[] png) {
            return bytes + encodedSize(itemid, png) <= MAX_CHUNK_BYTES;
        }

        public void add(String itemid, byte[] png) {
            itemids.add(itemid);
            pngs.add(png);
            bytes += encodedSize(itemid, png);
        }

        public boolean isEmpty() {
            return itemids.isEmpty();
        }

        @Override
        public void fromBytes(ByteBuf buf) {
            int count = ByteBufUtils.readVarInt(buf, 5);
            for (int i = 0; i < count && buf.isReadable(); i++) {
                String itemid = ByteBufUtils.readUTF8String(buf);
                int length = ByteBufUtils.readVarInt(buf, 5);
                if (length < 0 || length > IconUpload.MAX_ICON_BYTES || length > buf.readableBytes()) {
                    throw new IllegalArgumentException("Malformed icon upload chunk");
                }
                byte[] png = new byte[length];
                buf.readBytes(png);
                itemids.add(itemid);
                pngs.add(png);
            }
        }

        @Override
        public void toBytes(ByteBuf buf) {
            ByteBufUtils.writeVarInt(buf, itemids.size(), 5);
            for (int i = 0; i < itemids.size(); i++) {
                ByteBufUtils.writeUTF8String(buf, itemids.get(i));
                ByteBufUtils.writeVarInt(buf, pngs.get(i).length, 5);
                buf.writeBytes(pngs.get(i));
            }
        }
    }

    /** Every icon was sent; the server installs them and answers with a RESULT {@link Status}. */
    public static final class End implements IMessage {

        @Override
        public void fromBytes(ByteBuf buf) {}

        @Override
        public void toBytes(ByteBuf buf) {}
    }

    /** The server's answer to Begin (ACCEPTED/REJECTED) or End (RESULT). */
    public static final class Status implements IMessage {

        public enum Kind {
            ACCEPTED,
            REJECTED,
            RESULT
        }

        public Kind kind;
        public String message;

        public Status() {}

        public Status(Kind kind, String message) {
            this.kind = kind;
            this.message = message;
        }

        @Override
        public void fromBytes(ByteBuf buf) {
            int ordinal = buf.readByte();
            kind = ordinal >= 0 && ordinal < Kind.values().length ? Kind.values()[ordinal] : Kind.REJECTED;
            message = ByteBufUtils.readUTF8String(buf);
        }

        @Override
        public void toBytes(ByteBuf buf) {
            buf.writeByte(kind.ordinal());
            ByteBufUtils.writeUTF8String(buf, message);
        }
    }
}
