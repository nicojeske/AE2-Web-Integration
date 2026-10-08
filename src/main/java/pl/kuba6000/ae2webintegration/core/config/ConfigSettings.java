package pl.kuba6000.ae2webintegration.core.config;

import com.electronwill.nightconfig.core.conversion.Path;

import pl.kuba6000.ae2webintegration.core.PasswordHelper;

@SuppressWarnings("PMD.AvoidMagicNumbers") // Defaults and bounds belong alongside their settings.
public final class ConfigSettings {

    public General general = new General();
    public Notifications notifications = new Notifications();
    public Discord discord = new Discord();
    public Ntfy ntfy = new Ntfy();
    public Tracking tracking = new Tracking();
    public Statistics statistics = new Statistics();
    public History history = new History();
    public GregTech gregtech = new GregTech();

    public static final class General {

        @Comment("Web server port (1-65535).")
        public int port = 2324;

        @Comment("Password for the Admin web account. Keep this secret.")
        public String password = PasswordHelper.generateDefaultPassword();

        @Path("allow_no_password_on_localhost")
        @Comment("Allow loopback clients to access the panel as admin without a password.")
        public boolean allowNoPasswordOnLocalhost = true;

        @Path("trusted_proxies")
        @Comment({ "Comma-separated trusted proxy IPs or CIDRs. Loopback proxies are trusted automatically.",
            "Only trust proxies you control; their forwarded client address affects admin access." })
        public String trustedProxies = "";

        @Path("public_mode")
        @Comment("Allow individual player accounts. When false, only the Admin account can log in.")
        public boolean publicMode = true;

        @Path("max_requests_before_logged_in_per_minute")
        @Comment("Unauthenticated requests per client per minute (1-1000).")
        public int maxRequestsBeforeLoggedInPerMinute = 20;

        @Path("check_for_updates")
        @Comment("Check for mod updates.")
        public boolean checkForUpdates = true;

        @Path("item_icon_directory")
        @Comment({ "Directory of item/fluid icon PNGs, used for real icons in the web terminal: the output of the",
            "client command /ae2webicons export (.minecraft/dumps/ae2webintegration_icons), copied to the server.",
            "Absolute, or relative to this config directory. Empty disables icons. The icon files are not",
            "distributed with the mod (copyright)." })
        public String itemIconDirectory = "";

    }

    public static final class Notifications {

        @Path("minimum_crafting_duration_seconds")
        @Comment("Minimum crafting duration in seconds for a notification. Zero disables this filter.")
        public int minimumCraftingDurationSeconds;

        @Path("minimum_crafting_amount")
        @Comment("Minimum crafted amount for a notification. Both notification minimums must be met.")
        public int minimumCraftingAmount;

        @Path("full_domain")
        @Comment("Web UI address opened when an ntfy notification is clicked. Empty disables the link.")
        public String fullDomain = "";

    }

    public static final class Discord {

        @Comment("Discord webhook URL. Empty disables notifications; public mode must also be disabled.")
        public String webhook = "";

        @Path("role_id")
        @Comment("Role to mention on errors. Empty disables mentions.")
        public String roleId = "";

    }

    public static final class Ntfy {

        @Comment("ntfy host. Empty disables this destination. https is assumed when no protocol is set.")
        public String host = "";

        @Comment("ntfy topic. Empty disables this destination.")
        public String topic = "";

        @Comment("ntfy username. Leave empty when the topic does not require authentication.")
        public String user = "";

        @Comment("ntfy password. Leave empty when the topic does not require authentication.")
        public String password = "";

    }

    public static final class Tracking {

        @Path("track_machine_crafting")
        @Comment("Track crafting requested directly by machines, rather than only player requests.")
        public boolean trackMachineCrafting;

    }

    public static final class Statistics {

        @Path("sample_interval_minutes")
        @Comment("How often, in minutes, to sample stored counts of tracked statistics items (1-60).")
        public int sampleIntervalMinutes = 5;

        @Path("fine_retention_days")
        @Comment("Days of full-resolution statistics history to keep per item (1-90).")
        public int fineRetentionDays = 30;

        @Path("hourly_retention_days")
        @Comment("Days of hourly-rollup statistics history to keep per item, beyond the fine window (1-3650).")
        public int hourlyRetentionDays = 365;

        @Path("max_tracked_items_per_grid")
        @Comment("Maximum number of items a single grid may track statistics history for (1-128).")
        public int maxTrackedItemsPerGrid = 24;

    }

    public static final class History {

        @Path("jdbc_url")
        @Comment({ "PostgreSQL JDBC URL (jdbc:postgresql://host:5432/db) to store statistics and GregTech history in,",
            "instead of JSON files next to this config. TimescaleDB is used automatically when installed.",
            "Empty uses the JSON files. The environment variable AE2WEB_HISTORY_JDBC_URL overrides this." })
        public String jdbcUrl = "";

        @Path("db_user")
        @Comment("Database user, unless the URL carries one. Overridden by AE2WEB_HISTORY_DB_USER.")
        public String dbUser = "";

        @Path("db_password")
        @Comment({ "Database password, unless the URL carries one. Overridden by AE2WEB_HISTORY_DB_PASSWORD,",
            "which is preferable to writing it here." })
        public String dbPassword = "";

    }

    public static final class GregTech {

        @Comment("Enable the GregTech pages. Only has an effect on versions with GregTech installed.")
        public boolean enabled = true;

        @Path("scan_interval_seconds")
        @Comment("How often, in seconds, to scan loaded GregTech multiblocks and power sources (2-300).")
        public int scanIntervalSeconds = 10;

        @Path("power_sample_interval_seconds")
        @Comment("How often, in seconds, to record a power history sample, rounded up to whole scans (10-3600).")
        public int powerSampleIntervalSeconds = 30;

        @Path("power_fine_retention_hours")
        @Comment("Hours of full-resolution power history to keep per power source (1-168).")
        public int powerFineRetentionHours = 24;

        @Path("power_hourly_retention_days")
        @Comment("Days of hourly power history to keep per power source (1-365).")
        public int powerHourlyRetentionDays = 30;

        @Path("production_hourly_retention_days")
        @Comment("Days of hourly production totals to keep per machine and item (1-30).")
        public int productionHourlyRetentionDays = 7;

        @Path("production_daily_retention_days")
        @Comment("Days of daily production totals to keep per machine and item (1-3650).")
        public int productionDailyRetentionDays = 90;

        @Path("machine_forget_days")
        @Comment("Forget a machine not seen in a scan (chunk unloaded or machine removed) for this many days (1-365).")
        public int machineForgetDays = 7;

    }

    private static void requireRange(String name, int value, int min, int max) {
        if (value < min || value > max) {
            throw new IllegalArgumentException(name + " must be between " + min + " and " + max);
        }
    }

    void validate() {
        if (general.port < 1 || general.port > 65535)
            throw new IllegalArgumentException("general.port must be between 1 and 65535");
        if (general.maxRequestsBeforeLoggedInPerMinute < 1 || general.maxRequestsBeforeLoggedInPerMinute > 1000) {
            throw new IllegalArgumentException(
                "general.max_requests_before_logged_in_per_minute must be between 1 and 1000");
        }
        if (notifications.minimumCraftingDurationSeconds < 0 || notifications.minimumCraftingAmount < 0) {
            throw new IllegalArgumentException("Notification minimums must not be negative");
        }
        requireRange("statistics.sample_interval_minutes", statistics.sampleIntervalMinutes, 1, 60);
        requireRange("statistics.fine_retention_days", statistics.fineRetentionDays, 1, 90);
        requireRange("statistics.hourly_retention_days", statistics.hourlyRetentionDays, 1, 3650);
        requireRange("statistics.max_tracked_items_per_grid", statistics.maxTrackedItemsPerGrid, 1, 128);
        requireRange("gregtech.scan_interval_seconds", gregtech.scanIntervalSeconds, 2, 300);
        requireRange("gregtech.power_sample_interval_seconds", gregtech.powerSampleIntervalSeconds, 10, 3600);
        requireRange("gregtech.power_fine_retention_hours", gregtech.powerFineRetentionHours, 1, 168);
        requireRange("gregtech.power_hourly_retention_days", gregtech.powerHourlyRetentionDays, 1, 365);
        requireRange("gregtech.production_hourly_retention_days", gregtech.productionHourlyRetentionDays, 1, 30);
        requireRange("gregtech.production_daily_retention_days", gregtech.productionDailyRetentionDays, 1, 3650);
        requireRange("gregtech.machine_forget_days", gregtech.machineForgetDays, 1, 365);
    }
}
