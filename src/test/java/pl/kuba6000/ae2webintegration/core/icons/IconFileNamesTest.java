package pl.kuba6000.ae2webintegration.core.icons;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

/** Tests for {@link IconFileNames} - the itemid <-> icon file name encoding. */
class IconFileNamesTest {

    @Test
    void itemIdsUseTildeForColons() {
        assertEquals("minecraft~iron_ingot~0.png", IconFileNames.fileName("minecraft:iron_ingot:0"));
        assertEquals("gregtech~gt.metaitem.01~11020.png", IconFileNames.fileName("gregtech:gt.metaitem.01:11020"));
    }

    @Test
    void fluidIdsAreKeptAsIs() {
        assertEquals("chlorine.png", IconFileNames.fileName("chlorine"));
        assertEquals("molten.silicon-solar_grade.png", IconFileNames.fileName("molten.silicon-solar_grade"));
    }

    @Test
    void unsafeAndNonAsciiCharactersArePercentEncoded() {
        assertEquals("a%2Fb%5Cc%20d%7Ee%25f.png", IconFileNames.fileName("a/b\\c d~e%f"));
        assertEquals("mod~%C3%A4~0.png", IconFileNames.fileName("mod:ä:0"));
    }

    @Test
    void roundTrips() {
        for (String id : new String[] { "minecraft:iron_ingot:0", "chlorine", "a/b\\c d~e%f", "mod:ä:0",
            "ic2:itemCellEmpty:32767", "x:..:1" }) {
            assertEquals(id, IconFileNames.itemId(IconFileNames.fileName(id)), id);
        }
    }

    @Test
    void nonCanonicalOrForeignNamesDecodeToNull() {
        assertNull(IconFileNames.itemId("Redstone Dust.png"));
        assertNull(IconFileNames.itemId("minecraft~redstone~0.txt"));
        assertNull(IconFileNames.itemId(".png"));
        assertNull(IconFileNames.itemId("a%2fb.png"));
        assertNull(IconFileNames.itemId("a%41.png"));
        assertNull(IconFileNames.itemId("a%4.png"));
        assertNull(IconFileNames.itemId("a%FF.png"));
    }
}
