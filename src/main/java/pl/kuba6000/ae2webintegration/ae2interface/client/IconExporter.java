package pl.kuba6000.ae2webintegration.ae2interface.client;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.IntBuffer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import javax.imageio.ImageIO;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ChatComponentText;
import net.minecraft.util.EnumChatFormatting;
import net.minecraft.util.IIcon;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidRegistry;

import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import cpw.mods.fml.common.registry.GameData;
import pl.kuba6000.ae2webintegration.ae2interface.AE2WebIntegration;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTIconStacks;
import pl.kuba6000.ae2webintegration.ae2interface.util.StackIds;
import pl.kuba6000.ae2webintegration.core.icons.IconFileNames;

/**
 * Renders every item and fluid the client knows about to PNGs for the web terminal's icons, one file per itemid
 * (see {@link IconFileNames}), which the server's {@code general.item_icon_directory} then points at. Unlike NEI's
 * item panel dump this enumerates the registries themselves, so items hidden from NEI and plain fluids are
 * included, and files are keyed by the same itemid the web terminal uses instead of a display name.
 * <p>
 * Rendering happens on the client thread, one grid of icons per frame into an off-screen framebuffer, so the game
 * stays responsive; PNG encoding runs on a background thread, one batch at a time.
 */
public final class IconExporter {

    public static final String OUTPUT_DIRECTORY = "dumps/ae2webintegration_icons";

    /** Pixel edge of one batch's framebuffer: {@code 1024 / size} icons per row and column. */
    private static final int BATCH_PIXELS = 1024;
    /** GUI units an item renders into. */
    private static final int CELL = 16;

    private static final RenderItem ITEM_RENDER = new RenderItem();

    private static IconExporter active;

    private final File directory;
    private final int size;
    private final int grid;
    private final List<Icon> icons;
    private final ExecutorService writer = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "ae2webintegration-icon-writer");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicInteger written = new AtomicInteger();
    private final AtomicInteger empty = new AtomicInteger();
    private final AtomicInteger writeFailures = new AtomicInteger();
    private Framebuffer framebuffer;
    private Future<?> pendingWrite;
    private int next;
    private int renderFailures;
    private int nextProgressPercent = 25;

    private IconExporter(File directory, int size, List<Icon> icons) {
        this.directory = directory;
        this.size = size;
        this.grid = BATCH_PIXELS / size;
        this.icons = icons;
    }

    /** Starts an export at {@code size} pixels per icon. Returns an error message, or {@code null} once started. */
    public static String start(int size) {
        if (active != null) {
            return "An icon export is already running.";
        }
        if (!OpenGlHelper.isFramebufferEnabled()) {
            return "Icon export needs framebuffer support (fboEnable:true in options.txt).";
        }
        File directory = new File(Minecraft.getMinecraft().mcDataDir, OUTPUT_DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            return "Can't create " + directory;
        }
        File[] old = directory.listFiles((dir, name) -> name.endsWith(IconFileNames.EXTENSION));
        if (old != null) {
            for (File file : old) {
                // noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
        List<Icon> icons = collect();
        active = new IconExporter(directory, size, icons);
        AE2WebIntegration.LOG.info("Exporting {} icons at {}px to {}", icons.size(), size, directory);
        chat(EnumChatFormatting.GREEN + "Exporting " + icons.size() + " item and fluid icons to " + OUTPUT_DIRECTORY);
        return null;
    }

    private static List<Icon> collect() {
        Map<String, Icon> icons = new LinkedHashMap<>();
        if (Loader.isModLoaded("gregtech")) {
            GTIconStacks.withAllItemsShown(() -> {
                collectItems(icons, true);
                return null;
            });
        } else {
            collectItems(icons, false);
        }
        int items = icons.size();
        for (Fluid fluid : FluidRegistry.getRegisteredFluids()
            .values()) {
            IIcon texture = fluidTexture(fluid);
            if (texture != null) {
                icons.putIfAbsent(StackIds.fluidId(fluid), Icon.fluid(fluid, texture));
            }
        }
        AE2WebIntegration.LOG.info("Icon export: {} items, {} fluids", items, icons.size() - items);
        return new ArrayList<>(icons.values());
    }

    @SuppressWarnings("unchecked")
    private static void collectItems(Map<String, Icon> out, boolean gregtech) {
        for (Item item : (Iterable<Item>) GameData.getItemRegistry()) {
            List<ItemStack> stacks = new ArrayList<>();
            // Items with no creative tab still list their base stack for the null tab; a few mods throw on it.
            List<CreativeTabs> tabs = new ArrayList<>();
            for (CreativeTabs tab : item.getCreativeTabs()) {
                if (tab != null) tabs.add(tab);
            }
            tabs.add(null);
            for (CreativeTabs tab : tabs) {
                try {
                    item.getSubItems(item, tab, stacks);
                } catch (Throwable t) {
                    AE2WebIntegration.LOG.debug("Icon export: getSubItems failed for {}", item, t);
                }
            }
            if (gregtech) {
                GTIconStacks.addEnabledMetaItems(item, stacks);
            }
            for (ItemStack stack : stacks) {
                if (stack != null && stack.getItem() != null) {
                    out.putIfAbsent(StackIds.itemId(stack.getItem(), stack.getItemDamage()), Icon.item(stack));
                }
            }
        }
    }

    private static IIcon fluidTexture(Fluid fluid) {
        try {
            IIcon icon = fluid.getIcon();
            if (icon == null && fluid.getBlock() != null) {
                icon = fluid.getBlock()
                    .getIcon(0, 0);
            }
            return icon;
        } catch (Throwable t) {
            return null;
        }
    }

    private void tick() {
        if (pendingWrite != null && !pendingWrite.isDone()) {
            return;
        }
        if (next < icons.size()) {
            renderBatch();
            int percent = next * 100 / icons.size();
            if (percent >= nextProgressPercent && next < icons.size()) {
                chat(EnumChatFormatting.GRAY + "Icon export: " + percent + "%");
                nextProgressPercent = (percent / 25 + 1) * 25;
            }
        } else {
            finish();
        }
    }

    private void renderBatch() {
        Minecraft mc = Minecraft.getMinecraft();
        if (framebuffer == null) {
            framebuffer = new Framebuffer(BATCH_PIXELS, BATCH_PIXELS, true);
            framebuffer.setFramebufferColor(0, 0, 0, 0);
        }
        List<Icon> batch = new ArrayList<>(icons.subList(next, Math.min(icons.size(), next + grid * grid)));
        next += batch.size();

        framebuffer.framebufferClear();
        framebuffer.bindFramebuffer(true);
        GL11.glPushAttrib(GL11.GL_ALL_ATTRIB_BITS);
        GL11.glMatrixMode(GL11.GL_PROJECTION);
        GL11.glPushMatrix();
        GL11.glLoadIdentity();
        GL11.glOrtho(0, grid * CELL, grid * CELL, 0, 1000, 3000);
        GL11.glMatrixMode(GL11.GL_MODELVIEW);
        GL11.glPushMatrix();
        GL11.glLoadIdentity();
        GL11.glTranslatef(0, 0, -2000);
        GL11.glEnable(GL12.GL_RESCALE_NORMAL);
        GL11.glEnable(GL11.GL_DEPTH_TEST);
        GL11.glColor4f(1, 1, 1, 1);

        for (int i = 0; i < batch.size(); i++) {
            int stackDepth = GL11.glGetInteger(GL11.GL_MODELVIEW_STACK_DEPTH);
            try {
                batch.get(i)
                    .render(mc, i % grid * CELL, i / grid * CELL);
            } catch (Throwable t) {
                renderFailures++;
                AE2WebIntegration.LOG.warn("Icon export: rendering {} failed", batch.get(i).id, t);
                recoverFromFailedRender(stackDepth);
            }
        }

        IntBuffer buffer = BufferUtils.createIntBuffer(BATCH_PIXELS * BATCH_PIXELS);
        GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, 1);
        GL11.glReadPixels(0, 0, BATCH_PIXELS, BATCH_PIXELS, GL12.GL_BGRA, GL12.GL_UNSIGNED_INT_8_8_8_8_REV, buffer);

        RenderHelper.disableStandardItemLighting();
        GL11.glMatrixMode(GL11.GL_PROJECTION);
        GL11.glPopMatrix();
        GL11.glMatrixMode(GL11.GL_MODELVIEW);
        GL11.glPopMatrix();
        GL11.glPopAttrib();
        framebuffer.unbindFramebuffer();
        mc.getFramebuffer()
            .bindFramebuffer(true);

        int[] argb = new int[BATCH_PIXELS * BATCH_PIXELS];
        buffer.get(argb);
        pendingWrite = writer.submit(() -> writeBatch(argb, batch));
    }

    /** Undoes what a render that threw half-way may have left behind, so it doesn't break the rest of the batch. */
    private static void recoverFromFailedRender(int stackDepth) {
        try {
            Tessellator.instance.draw();
        } catch (IllegalStateException notDrawing) {
            // the usual case
        }
        GL11.glMatrixMode(GL11.GL_MODELVIEW);
        while (GL11.glGetInteger(GL11.GL_MODELVIEW_STACK_DEPTH) > stackDepth) {
            GL11.glPopMatrix();
        }
        GL11.glColor4f(1, 1, 1, 1);
    }

    private void writeBatch(int[] argb, List<Icon> batch) {
        for (int i = 0; i < batch.size(); i++) {
            BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
            int left = i % grid * size;
            int top = i / grid * size;
            boolean visible = false;
            for (int y = 0; y < size; y++) {
                // glReadPixels rows run bottom-up.
                int offset = (BATCH_PIXELS - 1 - (top + y)) * BATCH_PIXELS + left;
                image.setRGB(0, y, size, 1, argb, offset, BATCH_PIXELS);
                for (int x = 0; x < size && !visible; x++) {
                    visible = argb[offset + x] >>> 24 != 0;
                }
            }
            String id = batch.get(i).id;
            if (!visible) {
                // An empty icon would only hide the web terminal's placeholder tile.
                empty.incrementAndGet();
                continue;
            }
            try {
                ImageIO.write(image, "png", new File(directory, IconFileNames.fileName(id)));
                written.incrementAndGet();
            } catch (IOException e) {
                writeFailures.incrementAndGet();
                AE2WebIntegration.LOG.warn("Icon export: writing {} failed", id, e);
            }
        }
    }

    private void finish() {
        active = null;
        writer.shutdown();
        if (framebuffer != null) {
            framebuffer.deleteFramebuffer();
        }
        String summary = "Exported " + written.get()
            + " icons to "
            + OUTPUT_DIRECTORY
            + " ("
            + empty.get()
            + " rendered empty, "
            + (renderFailures + writeFailures.get())
            + " failed). Copy the directory to the server and point general.item_icon_directory at it.";
        AE2WebIntegration.LOG.info(summary);
        chat(EnumChatFormatting.GREEN + summary);
    }

    private static void chat(String message) {
        Minecraft mc = Minecraft.getMinecraft();
        if (mc.thePlayer != null) {
            mc.thePlayer.addChatMessage(new ChatComponentText(message));
        }
    }

    /** Drives the active export; registered once on the FML bus by the client proxy. */
    public static final class RenderHook {

        @SubscribeEvent
        public void onRenderTick(TickEvent.RenderTickEvent event) {
            if (event.phase == TickEvent.Phase.END && active != null) {
                active.tick();
            }
        }
    }

    private static final class Icon {

        final String id;
        final ItemStack stack;
        final IIcon fluidTexture;
        final int fluidColor;

        private Icon(String id, ItemStack stack, IIcon fluidTexture, int fluidColor) {
            this.id = id;
            this.stack = stack;
            this.fluidTexture = fluidTexture;
            this.fluidColor = fluidColor;
        }

        static Icon item(ItemStack stack) {
            return new Icon(StackIds.itemId(stack.getItem(), stack.getItemDamage()), stack, null, 0);
        }

        static Icon fluid(Fluid fluid, IIcon texture) {
            return new Icon(StackIds.fluidId(fluid), null, texture, fluid.getColor());
        }

        void render(Minecraft mc, int x, int y) {
            if (stack != null) {
                RenderHelper.enableGUIStandardItemLighting();
                ITEM_RENDER.zLevel = 100;
                ITEM_RENDER.renderItemAndEffectIntoGUI(mc.fontRenderer, mc.getTextureManager(), stack, x, y);
                return;
            }
            RenderHelper.disableStandardItemLighting();
            GL11.glEnable(GL11.GL_BLEND);
            OpenGlHelper.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, 1, 0);
            mc.getTextureManager()
                .bindTexture(TextureMap.locationBlocksTexture);
            GL11.glColor4f(
                (fluidColor >> 16 & 0xFF) / 255f,
                (fluidColor >> 8 & 0xFF) / 255f,
                (fluidColor & 0xFF) / 255f,
                1);
            Tessellator tessellator = Tessellator.instance;
            tessellator.startDrawingQuads();
            tessellator.addVertexWithUV(x, y + CELL, 100, fluidTexture.getMinU(), fluidTexture.getMaxV());
            tessellator.addVertexWithUV(x + CELL, y + CELL, 100, fluidTexture.getMaxU(), fluidTexture.getMaxV());
            tessellator.addVertexWithUV(x + CELL, y, 100, fluidTexture.getMaxU(), fluidTexture.getMinV());
            tessellator.addVertexWithUV(x, y, 100, fluidTexture.getMinU(), fluidTexture.getMinV());
            tessellator.draw();
            GL11.glColor4f(1, 1, 1, 1);
        }
    }
}
