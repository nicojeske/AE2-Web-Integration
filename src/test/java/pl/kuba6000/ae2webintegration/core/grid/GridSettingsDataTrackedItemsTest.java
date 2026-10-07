package pl.kuba6000.ae2webintegration.core.grid;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.core.utils.GSONUtils;

class GridSettingsDataTrackedItemsTest {

    private static final String ITEM = "minecraft:iron_ingot";

    private final AtomicInteger dirtyMarks = new AtomicInteger();
    private GridSettingsData data;

    @BeforeEach
    void attach() {
        data = new GridSettingsData();
        data.attach(new Object(), dirtyMarks::incrementAndGet);
    }

    private static Map<String, String> nameOf(String itemid, String name) {
        Map<String, String> map = new LinkedHashMap<>();
        map.put(itemid, name);
        return map;
    }

    @Test
    void updateTrackedItemNamesRemembersANameForATrackedItem() {
        data.setTrackedItems(Arrays.asList(ITEM));
        int marks = dirtyMarks.get();

        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));

        assertEquals(
            "Iron Ingot",
            data.getTrackedItemNames()
                .get(ITEM));
        assertEquals(marks + 1, dirtyMarks.get());
    }

    @Test
    void aRememberedNameSurvivesALaterSampleWhereTheItemIsAbsent() {
        data.setTrackedItems(Arrays.asList(ITEM));
        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));
        int marks = dirtyMarks.get();

        // A sample pass where the item wasn't seen in storage returns no observed name for it at all -
        // the store never claims "no name", so the merge must leave the existing one untouched.
        data.updateTrackedItemNames(Collections.emptyMap());

        assertEquals(marks, dirtyMarks.get());
        assertEquals(
            "Iron Ingot",
            data.getTrackedItemNames()
                .get(ITEM));
    }

    @Test
    void updateTrackedItemNamesIgnoresAnObservationForAnItemThatIsNotTracked() {
        data.setTrackedItems(Arrays.asList(ITEM));
        int marks = dirtyMarks.get();

        data.updateTrackedItemNames(nameOf("minecraft:gold_ingot", "Gold Ingot"));

        assertEquals(marks, dirtyMarks.get());
        assertTrue(
            data.getTrackedItemNames()
                .isEmpty());
    }

    @Test
    void settingTrackedItemsPrunesNamesForItemsNoLongerTracked() {
        data.setTrackedItems(Arrays.asList(ITEM, "minecraft:gold_ingot"));
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
        data.setTrackedItems(Arrays.asList(ITEM));
        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));
        int marks = dirtyMarks.get();

        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));

        assertEquals(marks, dirtyMarks.get());
    }

    @Test
    void settingTheSameTrackedItemsAgainDoesNotMarkDirty() {
        data.setTrackedItems(Arrays.asList(ITEM));
        int marks = dirtyMarks.get();

        data.setTrackedItems(Arrays.asList(ITEM));

        assertEquals(marks, dirtyMarks.get());
    }

    @Test
    void trackedItemsKeepTheGridOutOfTheDefaultSettings() {
        assertTrue(data.isDefault());

        data.setTrackedItems(Arrays.asList(ITEM));

        assertFalse(data.isDefault());
    }

    @Test
    void settingsSavedBeforeTrackedItemsExistedLoadAsEmpty() {
        GridSettingsData loaded = GSONUtils.GSON_BUILDER.create()
            .fromJson("{\"isTracked\":true}", GridSettingsData.class);
        loaded.attach(new Object(), () -> {});

        assertTrue(
            loaded.getTrackedItems()
                .isEmpty());
        assertTrue(
            loaded.getTrackedItemNames()
                .isEmpty());
    }

    @Test
    void trackedItemsSurviveAGsonRoundTrip() {
        data.setTrackedItems(Arrays.asList(ITEM));
        data.updateTrackedItemNames(nameOf(ITEM, "Iron Ingot"));

        String json = GSONUtils.GSON_BUILDER.create()
            .toJson(data);
        GridSettingsData loaded = GSONUtils.GSON_BUILDER.create()
            .fromJson(json, GridSettingsData.class);
        loaded.attach(new Object(), () -> {});

        assertEquals(data.getTrackedItems(), loaded.getTrackedItems());
        assertEquals(data.getTrackedItemNames(), loaded.getTrackedItemNames());
    }
}
