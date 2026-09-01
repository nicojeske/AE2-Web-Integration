package pl.kuba6000.ae2webintegration.core.icons;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Tests for {@link ItemIconIndex} - the display-name -> icon-file matching logic. */
class ItemIconIndexTest {

    @TempDir
    File dir;

    private File touch(String name) throws Exception {
        File file = new File(dir, name);
        Files.write(file.toPath(), new byte[] { (byte) 0x89, 'P', 'N', 'G' });
        return file;
    }

    @Test
    void disabledIndexMatchesNothing() {
        ItemIconIndex index = ItemIconIndex.disabled();
        assertFalse(index.isEnabled());
        assertEquals(0, index.size());
        assertNull(index.lookup("Redstone"));
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
    void exactNameMatches() throws Exception {
        touch("Redstone.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertTrue(index.isEnabled());
        assertEquals(1, index.size());
        assertEquals(new File(dir, "Redstone.png"), index.lookup("Redstone"));
    }

    @Test
    void matchIsCaseAndWhitespaceInsensitive() throws Exception {
        touch("ME Storage Cell.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(new File(dir, "ME Storage Cell.png"), index.lookup("me   storage    cell"));
        assertEquals(new File(dir, "ME Storage Cell.png"), index.lookup("ME STORAGE CELL"));
    }

    @Test
    void sectionFormatCodesAreStrippedBeforeMatching() throws Exception {
        touch("Processor (Calculation).png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(new File(dir, "Processor (Calculation).png"), index.lookup("§b§lProcessor (Calculation)"));
    }

    @Test
    void colonInDisplayNameMatchesUnderscoreInFilename() throws Exception {
        // The icon export itself replaced path-unsafe characters (/, \, :) with '_' when it wrote files.
        touch("Crafting Pattern #1_ 1x1.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(new File(dir, "Crafting Pattern #1_ 1x1.png"), index.lookup("Crafting Pattern #1: 1x1"));
    }

    @Test
    void hashAndSuperscriptCharactersMatchExactly() throws Exception {
        touch("Map #0.png");
        touch("128³ Spatial Component.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(new File(dir, "Map #0.png"), index.lookup("Map #0"));
        assertEquals(new File(dir, "128³ Spatial Component.png"), index.lookup("128³ Spatial Component"));
    }

    @Test
    void apostropheDoesNotMatchWithoutIt() throws Exception {
        touch("4,4'-Diphenylmethane Diisocyanate Dust.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertNull(index.lookup("4,4-Diphenylmethane Diisocyanate Dust"));
    }

    @Test
    void numberedCollisionVariantIsNotReachableByThePlainName() throws Exception {
        touch("Fir Wood Planks.png");
        touch("Fir Wood Planks_2.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(2, index.size());
        assertEquals(new File(dir, "Fir Wood Planks.png"), index.lookup("Fir Wood Planks"));
        // The "_2" variant is indexed under its own distinct key - a display name of "Fir Wood Planks"
        // never resolves to it, only its own literal (numbered) name does.
        assertEquals(new File(dir, "Fir Wood Planks_2.png"), index.lookup("Fir Wood Planks_2"));
    }

    @Test
    void nonPngFilesAreIgnored() throws Exception {
        touch("Redstone.png");
        Files.write(new File(dir, "notes.txt").toPath(), "hi".getBytes());
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertEquals(1, index.size());
    }

    @Test
    void pathTraversalAttemptsMiss() throws Exception {
        touch("Redstone.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertNull(index.lookup("../../etc/passwd"));
        assertNull(index.lookup("a/b"));
        assertNull(index.lookup("a\\b"));
        assertNull(index.lookup("a\0b"));
    }

    @Test
    void unknownNameMisses() throws Exception {
        touch("Redstone.png");
        ItemIconIndex index = ItemIconIndex.scan(dir);
        assertNull(index.lookup("Diamond"));
    }
}
