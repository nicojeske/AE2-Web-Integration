package pl.kuba6000.ae2webintegration.core.gt;

import java.math.BigInteger;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTScanResult;
import pl.kuba6000.ae2webintegration.core.api.gt.IGTProvider;
import pl.kuba6000.ae2webintegration.core.config.Config;

/**
 * Shared fakes for the GregTech tests, public so request-level tests in the {@code core} package can reach
 * the package-private engine hooks.
 */
public final class GTTestSupport {

    private GTTestSupport() {}

    /** A provider that returns whatever {@link #next} holds, counting calls; throws if {@link #fail} is set. */
    public static final class FakeProvider implements IGTProvider {

        public GTScanResult next = new GTScanResult();
        public int scans;
        public boolean fail;

        @Override
        public GTScanResult scan(long nowMillis) {
            scans++;
            if (fail) {
                throw new IllegalStateException("boom");
            }
            return next;
        }
    }

    public static void reset() {
        GTEngine.resetForTests();
        resetConfig();
    }

    public static void resetConfig() {
        Config.INSTANCE.gregtech.enabled = true;
        Config.INSTANCE.gregtech.scanIntervalSeconds = 10;
        Config.INSTANCE.gregtech.powerSampleIntervalSeconds = 30;
        Config.INSTANCE.gregtech.powerFineRetentionHours = 24;
        Config.INSTANCE.gregtech.powerHourlyRetentionDays = 30;
        Config.INSTANCE.gregtech.productionHourlyRetentionDays = 7;
        Config.INSTANCE.gregtech.productionDailyRetentionDays = 90;
        Config.INSTANCE.gregtech.machineForgetDays = 7;
    }

    /** Registers {@code provider} and runs one scan at {@code nowMillis}, as the server tick would. */
    public static void scan(FakeProvider provider, long nowMillis) {
        GTEngine.registerProvider(provider);
        // A minute apart in "nanos": every scan and power sample is due, while the 15-minute background save
        // stays out of the way of @TempDir cleanup.
        tickNanos += TimeUnit.MINUTES.toNanos(1);
        GTEngine.onServerTick(tickNanos, nowMillis);
    }

    static long tickNanos;

    public static UUID uuid(String name) {
        return UUID.nameUUIDFromBytes(name.getBytes());
    }

    public static GTMachineSnapshot machine(int x, UUID owner, GTMachineStatus status) {
        GTMachineSnapshot machine = new GTMachineSnapshot();
        machine.id = GTMachineSnapshot.idOf(0, x, 64, 0);
        machine.x = x;
        machine.y = 64;
        machine.name = "Machine " + x;
        machine.type = "multimachine.test";
        machine.owner = owner;
        machine.status = status;
        return machine;
    }

    public static GTPowerSourceSnapshot lsc(int x, UUID owner, long stored, long capacity, Long in, Long out) {
        GTPowerSourceSnapshot source = new GTPowerSourceSnapshot();
        source.id = GTPowerSourceSnapshot.lscId(0, x, 64, 0);
        source.kind = GTPowerSourceSnapshot.Kind.LSC;
        source.name = "LSC " + x;
        source.owner = owner;
        source.stored = BigInteger.valueOf(stored);
        source.capacity = BigInteger.valueOf(capacity);
        source.avgInPerTick = in;
        source.avgOutPerTick = out;
        return source;
    }

    public static GTPowerSourceSnapshot wireless(UUID team, BigInteger stored) {
        GTPowerSourceSnapshot source = new GTPowerSourceSnapshot();
        source.id = GTPowerSourceSnapshot.wirelessId(team);
        source.kind = GTPowerSourceSnapshot.Kind.WIRELESS;
        source.name = "Wireless";
        source.owner = team;
        source.stored = stored;
        return source;
    }
}
