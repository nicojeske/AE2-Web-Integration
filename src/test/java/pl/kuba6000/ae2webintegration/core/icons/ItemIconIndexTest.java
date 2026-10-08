package pl.kuba6000.ae2webintegration.core.icons;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Tests for {@link ItemIconIndex} - the itemid -> icon-file lookup over an exporter's output. */
class ItemIconIndexTest {

    @TempDir
    File dir;

    private File touch(String name) throws Exception {
        File file = new File(dir, name);
        Files.write(file.toPath(), new byte[] { (byte) 0x89, 'P', 'N', 'G' });
        return file;
    }

    private File touchIcon(String itemid) throws Exception {
        return touch(IconFileNames.fileName(itemid));
    }

    @Test
    void disabledIndexMatchesNothing() {
        ItemIconIndex index = ItemIconIndex.disabled();
        assertFalse(index.isEnabled());
        assertEquals(0, index.size());
        assertNull(index.lookup("minecraft:redstone:0"));
    }

    @Test
    void missingDirectoryYieldsDisabledIndex() {
        ItemIconIndex index = ItemIconIndex.scan(new File(dir, "does-not-exist"));
        assertFalse(index.isEnabled());
    }

    @Test
    void emptyDirectoryYieldsDisabledIndex() {
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertFalse(index.isEnabled());
    }

    @Test
    void itemAndFluidIdsMatchExactly() throws Exception {
        File redstone = touchIcon("minecraft:redstone:0");
        File metaItem = touchIcon("gregtech:gt.metaitem.01:11020");
        File chlorine = touchIcon("chlorine");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertTrue(index.isEnabled());
        assertEquals(3, index.size());
        assertEquals(redstone, index.lookup("minecraft:redstone:0"));
        assertEquals(metaItem, index.lookup("gregtech:gt.metaitem.01:11020"));
        assertEquals(chlorine, index.lookup("chlorine"));
    }

    @Test
    void otherDamageValuesAndCaseMiss() throws Exception {
        touchIcon("minecraft:wool:0");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertNull(index.lookup("minecraft:wool:1"));
        assertNull(index.lookup("Minecraft:Wool:0"));
        assertNull(index.lookup(null));
    }

    @Test
    void filesNotNamedLikeAnExportAreIgnored() throws Exception {
        touchIcon("minecraft:redstone:0");
        touch("Redstone Dust.png");
        Files.write(new File(dir, "notes.txt").toPath(), "hi".getBytes());
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(1, index.size());
        assertNull(index.lookup("Redstone Dust"));
    }

    @Test
    void directoryWithOnlyForeignFilesYieldsDisabledIndex() throws Exception {
        touch("Redstone Dust.png");
        assertFalse(
            ItemIconIndex.scan(dir)
                .isEnabled());
    }

    @Test
    void pathTraversalAttemptsMiss() throws Exception {
        touchIcon("minecraft:redstone:0");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertNull(index.lookup("../../etc/passwd"));
        assertNull(index.lookup("minecraft~redstone~0.png"));
    }
}
