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
        ConfigBootstrap.itemIconDirectoryValue = () -> "";
    }

    @Test
    void emptyValueIsDisabled() {
        ConfigBootstrap.itemIconDirectoryValue = () -> "";
        assertNull(Config.ITEM_ICON_DIRECTORY());
    }

    @Test
    void blankValueIsDisabled() {
        ConfigBootstrap.itemIconDirectoryValue = () -> "   ";
        assertNull(Config.ITEM_ICON_DIRECTORY());
    }

    @Test
    void absolutePathIsUsedAsIs() {
        File absolute = new File(configRoot, "elsewhere/icons").getAbsoluteFile();
        ConfigBootstrap.itemIconDirectoryValue = absolute::getPath;
        assertEquals(absolute, Config.ITEM_ICON_DIRECTORY());
    }

    @Test
    void relativePathResolvesAgainstConfigDirectory() {
        ConfigBootstrap.itemIconDirectoryValue = () -> "item_icons";
        assertEquals(new File(Config.getConfigDirectory(), "item_icons"), Config.ITEM_ICON_DIRECTORY());
        assertTrue(
            Config.ITEM_ICON_DIRECTORY()
                .getPath()
                .startsWith(configRoot.getPath()));
    }
}
