package pl.kuba6000.ae2webintegration.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * {@code GridData}'s remembered tracked-item display names ({@link GridData#updateTrackedItemNames} /
 * {@link GridData#getTrackedItemNames}), kept so a tracked item that empties out of the network (and so
 * drops out of {@code GetItems}) still resolves to a real name on the web terminal. Every test uses its
 * own grid key - {@code GridData}'s map is static for the whole test JVM.
 */
class GridDataTrackedItemNamesTest {

    private static final String ITEM = "minecraft:iron_ingot";

    private static Map<String, String> nameOf(String itemid, String name) {
        Map<String, String> map = new LinkedHashMap<>();
        map.put(itemid, name);
        return map;
    }

    @Test
    void updateTrackedItemNamesRemembersANameForATrackedItem() {
        GridData data = GridData.getOrCreate(960_101L);
        data.setTrackedItems(Arrays.asList(ITEM));

        assertTrue(data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot")));
        assertEquals(
            "Iron Ingot",
            data.getTrackedItemNames()
                .get(ITEM));
    }

    @Test
    void aRememberedNameSurvivesALaterSampleWhereTheItemIsAbsent() {
        GridData data = GridData.getOrCreate(960_102L);
        data.setTrackedItems(Arrays.asList(ITEM));
        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));

        // A sample pass where the item wasn't seen in storage returns no observed name for it at all -
        // the store never claims "no name", so the merge must leave the existing one untouched.
        assertFalse(data.updateTrackedItemNames(Collections.emptyMap()));
        assertEquals(
            "Iron Ingot",
            data.getTrackedItemNames()
                .get(ITEM));
    }

    @Test
    void updateTrackedItemNamesIgnoresAnObservationForAnItemThatIsNotTracked() {
        GridData data = GridData.getOrCreate(960_103L);
        data.setTrackedItems(Arrays.asList(ITEM));

        assertFalse(data.updateTrackedItemNames(nameOf("minecraft:gold_ingot", "Gold Ingot")));
        assertTrue(
            data.getTrackedItemNames()
                .isEmpty());
    }

    @Test
    void settingTrackedItemsPrunesNamesForItemsNoLongerTracked() {
        GridData data = GridData.getOrCreate(960_104L);
        data.setTrackedItems(Arrays.asList(ITEM, "minecraft:gold_ingot"));
        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));
        Map<String, String> both = new LinkedHashMap<>();
        both.put(ITEM, "Iron Ingot");
        both.put("minecraft:gold_ingot", "Gold Ingot");
        data.updateTrackedItemNames(both);

        data.setTrackedItems(Arrays.asList(ITEM));

        assertEquals(
            "Iron Ingot",
            data.getTrackedItemNames()
                .get(ITEM));
        assertFalse(
            data.getTrackedItemNames()
                .containsKey("minecraft:gold_ingot"));
    }

    @Test
    void reObservingTheSameNameReportsNoChange() {
        GridData data = GridData.getOrCreate(960_105L);
        data.setTrackedItems(Arrays.asList(ITEM));
        assertTrue(data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot")));

        assertFalse(data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot")));
    }
}
