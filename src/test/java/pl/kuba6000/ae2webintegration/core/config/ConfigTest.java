package pl.kuba6000.ae2webintegration.core.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Tests for {@link Config#ITEM_ICON_DIRECTORY()}'s path resolution. */
class ConfigTest {

    @TempDir
    File configRoot;

    @BeforeEach
    void setUp() {
        Config.init(configRoot);
    }

    @AfterEach
    void tearDown() {
        Config.INSTANCE.general.itemIconDirectory = "";
    }

    @Test
    void emptyValueIsDisabled() {
        Config.INSTANCE.general.itemIconDirectory = "";
        assertNull(Config.itemIconDirectory());
    }

    @Test
    void blankValueIsDisabled() {
        Config.INSTANCE.general.itemIconDirectory = "   ";
        assertNull(Config.itemIconDirectory());
    }

    @Test
    void absolutePathIsUsedAsIs() {
        File absolute = new File(configRoot, "elsewhere/icons").getAbsoluteFile();
        Config.INSTANCE.general.itemIconDirectory = absolute.getPath();
        assertEquals(absolute, Config.itemIconDirectory());
    }

    @Test
    void relativePathResolvesAgainstConfigDirectory() {
        Config.INSTANCE.general.itemIconDirectory = "item_icons";
        assertEquals(new File(Config.getConfigDirectory(), "item_icons"), Config.itemIconDirectory());
        assertTrue(
            Config.itemIconDirectory()
                .getPath()
                .startsWith(configRoot.getPath()));
    }
}
