package pl.kuba6000.ae2webintegration.core.history;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.TimeUnit;

import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Real databases for the history database tests: one TimescaleDB and one plain PostgreSQL container per
 * test JVM, started on first use. Every {@link #start} drops the mod's tables first, so each test sees an
 * empty database. Tests calling this are skipped, not failed, without Docker.
 */
public final class HistoryDbTestSupport {

    public enum Flavor {
        TIMESCALE,
        POSTGRES
    }

    private static PostgreSQLContainer<?> timescale;
    private static PostgreSQLContainer<?> postgres;

    private HistoryDbTestSupport() {}

    private static synchronized PostgreSQLContainer<?> container(Flavor flavor) {
        assumeTrue(
            DockerClientFactory.instance()
                .isDockerAvailable(),
            "Docker is not available");
        if (flavor == Flavor.TIMESCALE) {
            if (timescale == null) {
                timescale = new PostgreSQLContainer<>(
                    DockerImageName.parse("timescale/timescaledb:latest-pg17")
                        .asCompatibleSubstituteFor("postgres"));
                timescale.start();
            }
            return timescale;
        }
        if (postgres == null) {
            postgres = new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"));
            postgres.start();
        }
        return postgres;
    }

    /** Starts {@link HistoryDb} against an emptied database of the given flavor. */
    public static HistoryDb start(Flavor flavor) {
        HistoryDb.stop();
        PostgreSQLContainer<?> container = container(flavor);
        execute(flavor, connection -> {
            try (Statement st = connection.createStatement()) {
                if (flavor == Flavor.TIMESCALE) {
                    st.execute("CREATE EXTENSION IF NOT EXISTS timescaledb");
                }
                for (HistoryTable table : HistoryTable.values()) {
                    st.execute("DROP TABLE IF EXISTS " + table.sqlName() + " CASCADE");
                }
                st.execute("DROP TABLE IF EXISTS ae2wi_series, ae2wi_coverage, ae2wi_meta, ae2wi_craft_job CASCADE");
            }
        });
        HistoryDb db = HistoryDb.start(container.getJdbcUrl(), container.getUsername(), container.getPassword());
        assertTrue(db != null, "history database did not start");
        return db;
    }

    /** Stops and starts {@link HistoryDb} again on the same database, keeping its data - a server restart. */
    public static HistoryDb restart(Flavor flavor) {
        HistoryDb.stop();
        PostgreSQLContainer<?> container = container(flavor);
        HistoryDb db = HistoryDb.start(container.getJdbcUrl(), container.getUsername(), container.getPassword());
        assertTrue(db != null, "history database did not start");
        return db;
    }

    /** Starts {@link HistoryDb} against an address where nothing listens. */
    public static HistoryDb startUnreachable() {
        HistoryDb.stop();
        return HistoryDb.start("jdbc:postgresql://127.0.0.1:1/none", "nobody", "nothing");
    }

    public static void stop() {
        HistoryDb.stop();
    }

    /** Waits until everything queued so far is committed. */
    public static void flush() {
        HistoryDb db = HistoryDb.get();
        assertTrue(db != null && db.flush(TimeUnit.SECONDS.toMillis(30)), "history writes were not committed");
    }

    public static long rowCount(Flavor flavor, HistoryTable table) {
        return queryLong(flavor, "SELECT count(*) FROM " + table.sqlName());
    }

    public static long queryLong(Flavor flavor, String sql) {
        long[] result = new long[1];
        execute(flavor, connection -> {
            try (Statement st = connection.createStatement(); ResultSet rs = st.executeQuery(sql)) {
                rs.next();
                result[0] = rs.getLong(1);
            }
        });
        return result[0];
    }

    interface SqlConsumer {

        void accept(Connection connection) throws SQLException;
    }

    static void execute(Flavor flavor, SqlConsumer consumer) {
        PostgreSQLContainer<?> container = container(flavor);
        try (Connection connection = DriverManager
            .getConnection(container.getJdbcUrl(), container.getUsername(), container.getPassword())) {
            consumer.accept(connection);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }
}
