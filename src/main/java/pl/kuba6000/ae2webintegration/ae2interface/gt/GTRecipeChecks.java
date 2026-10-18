package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import gregtech.api.recipe.check.CheckRecipeResult;
import gregtech.api.recipe.check.CheckRecipeResultRegistry;

/**
 * Stable ids for GregTech's recipe check results. Parameterised results carry one ({@code insufficient_voltage},
 * {@code missing_item}...), but every simple one shares {@code simple_result} and keeps its key private, so those
 * are named after the {@link CheckRecipeResultRegistry} constant they equal ({@code NO_RECIPE} -> {@code no_recipe}).
 */
final class GTRecipeChecks {

    private static final String SIMPLE_ID = "simple_result";
    /** A simple result from an addon that is not one of GregTech's constants. */
    static final String OTHER = "other";

    private static final Map<CheckRecipeResult, String> SIMPLE_NAMES = simpleNames();

    private GTRecipeChecks() {}

    /** {@code null} for a successful check or none at all. */
    static String idOf(CheckRecipeResult check) {
        if (check == null || check.wasSuccessful() || CheckRecipeResultRegistry.NONE.equals(check)) return null;
        String id = check.getID();
        if (!SIMPLE_ID.equals(id)) return id;
        String name = SIMPLE_NAMES.get(check);
        return name != null ? name : OTHER;
    }

    private static Map<CheckRecipeResult, String> simpleNames() {
        Map<CheckRecipeResult, String> names = new LinkedHashMap<>();
        for (Field field : CheckRecipeResultRegistry.class.getFields()) {
            if (!Modifier.isStatic(field.getModifiers()) || field.getType() != CheckRecipeResult.class) continue;
            try {
                CheckRecipeResult result = (CheckRecipeResult) field.get(null);
                if (result != null) names.putIfAbsent(
                    result,
                    field.getName()
                        .toLowerCase(Locale.ROOT));
            } catch (IllegalAccessException ignored) {
                // public static fields are always readable
            }
        }
        return names;
    }
}
