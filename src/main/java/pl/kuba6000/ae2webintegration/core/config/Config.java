package pl.kuba6000.ae2webintegration.core.config;

import java.io.File;

public class Config {

    // todo: migrate to JSON format

    private static File configDirectory;

    // --- Delegating accessors (backed by ConfigBootstrap) ---

    // General
    public static int AE_PORT() {
        return ConfigBootstrap.aePortValue.get();
    }

    public static String AE_PASSWORD() {
        return ConfigBootstrap.aePasswordValue.get();
    }

    public static String TRUSTED_PROXIES() {
        return ConfigBootstrap.trustedProxiesValue.get();
    }

    public static boolean ALLOW_NO_PASSWORD_ON_LOCALHOST() {
        return ConfigBootstrap.allowNoPasswordOnLocalhostValue.get();
    }

    public static boolean AE_PUBLIC_MODE() {
        return ConfigBootstrap.aePublicModeValue.get();
    }

    public static int AE_MAX_REQUESTS_BEFORE_LOGGED_IN_PER_MINUTE() {
        return ConfigBootstrap.aeMaxRequestsBeforeLoggedInPerMinuteValue.get();
    }

    public static boolean CHECK_FOR_UPDATES() {
        return ConfigBootstrap.checkForUpdatesValue.get();
    }

    /**
     * Directory to look up item icon PNGs in, or {@code null} when unconfigured (icons disabled). An
     * absolute path is used as-is; a relative one is resolved against the config directory, matching how
     * {@link #getConfigFile(String)} anchors the other data files.
     */
    public static File ITEM_ICON_DIRECTORY() {
        String path = ConfigBootstrap.itemIconDirectoryValue.get();
        if (path == null || path.trim()
            .isEmpty()) {
            return null;
        }
        File file = new File(path.trim());
        if (file.isAbsolute() || configDirectory == null) {
            return file;
        }
        return new File(configDirectory, path.trim());
    }

    // Discord
    public static String DISCORD_WEBHOOK() {
        return ConfigBootstrap.discordWebhookValue.get();
    }

    public static String DISCORD_ROLE_ID() {
        return ConfigBootstrap.discordRoleIdValue.get();
    }

    public static int DISCORD_MINIMUM_CRAFTING_DURATION_SECONDS() {
        return ConfigBootstrap.discordMinimumCraftingDurationSecondsValue.get();
    }

    public static int DISCORD_MINIMUM_CRAFTING_AMOUNT() {
        return ConfigBootstrap.discordMinimumCraftingAmountValue.get();
    }

    // Tracking
    public static boolean TRACKING_TRACK_MACHINE_CRAFTING() {
        return ConfigBootstrap.trackingTrackMachineCraftingValue.get();
    }

    // Statistics
    public static int STATISTICS_SAMPLE_INTERVAL_MINUTES() {
        return ConfigBootstrap.statisticsSampleIntervalMinutesValue.get();
    }

    public static int STATISTICS_FINE_RETENTION_DAYS() {
        return ConfigBootstrap.statisticsFineRetentionDaysValue.get();
    }

    public static int STATISTICS_HOURLY_RETENTION_DAYS() {
        return ConfigBootstrap.statisticsHourlyRetentionDaysValue.get();
    }

    public static int STATISTICS_MAX_TRACKED_ITEMS_PER_GRID() {
        return ConfigBootstrap.statisticsMaxTrackedItemsPerGridValue.get();
    }

    // History database: environment variables win, so a Kubernetes secret never has to land in the config file.
    public static String HISTORY_JDBC_URL() {
        return envOr("AE2WEB_HISTORY_JDBC_URL", ConfigBootstrap.historyJdbcUrlValue.get());
    }

    public static String HISTORY_DB_USER() {
        return envOr("AE2WEB_HISTORY_DB_USER", ConfigBootstrap.historyDbUserValue.get());
    }

    public static String HISTORY_DB_PASSWORD() {
        return envOr("AE2WEB_HISTORY_DB_PASSWORD", ConfigBootstrap.historyDbPasswordValue.get());
    }

    private static String envOr(String variable, String configured) {
        String env = System.getenv(variable);
        if (env != null && !env.trim()
            .isEmpty()) {
            return env.trim();
        }
        return configured == null ? "" : configured.trim();
    }

    // GregTech
    public static boolean GT_ENABLED() {
        return ConfigBootstrap.gtEnabledValue.get();
    }

    public static int GT_SCAN_INTERVAL_SECONDS() {
        return ConfigBootstrap.gtScanIntervalSecondsValue.get();
    }

    public static int GT_POWER_SAMPLE_INTERVAL_SECONDS() {
        return ConfigBootstrap.gtPowerSampleIntervalSecondsValue.get();
    }

    public static int GT_POWER_FINE_RETENTION_HOURS() {
        return ConfigBootstrap.gtPowerFineRetentionHoursValue.get();
    }

    public static int GT_POWER_HOURLY_RETENTION_DAYS() {
        return ConfigBootstrap.gtPowerHourlyRetentionDaysValue.get();
    }

    public static int GT_PRODUCTION_HOURLY_RETENTION_DAYS() {
        return ConfigBootstrap.gtProductionHourlyRetentionDaysValue.get();
    }

    public static int GT_PRODUCTION_DAILY_RETENTION_DAYS() {
        return ConfigBootstrap.gtProductionDailyRetentionDaysValue.get();
    }

    public static int GT_MACHINE_FORGET_DAYS() {
        return ConfigBootstrap.gtMachineForgetDaysValue.get();
    }

    // --- Directory / file setup ---

    public static void init(File configDirectory) {
        Config.configDirectory = new File(configDirectory, "ae2webintegration");
        if (!Config.configDirectory.exists()) {
            Config.configDirectory.mkdirs();
        }
    }

    public static File getConfigDirectory() {
        return configDirectory;
    }

    public static File getConfigFile(String fileName) {
        return new File(configDirectory, fileName);
    }
}
