package pl.kuba6000.ae2webintegration.core.api.gt;

import java.util.Locale;

import org.jetbrains.annotations.Nullable;

/** Which side of a GregTech recipe a logged stack was on. */
public enum GTFlow {

    /** Outputs of a finished recipe. */
    PRODUCED,
    /** Inputs a recipe took when it started. */
    CONSUMED;

    /** The {@code flow} query value, or {@code null} when it names neither direction. */
    public static @Nullable GTFlow fromParam(String value) {
        if (value == null) return null;
        switch (value.toLowerCase(Locale.ROOT)) {
            case "produced":
                return PRODUCED;
            case "consumed":
                return CONSUMED;
            default:
                return null;
        }
    }
}
