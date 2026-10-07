package pl.kuba6000.ae2webintegration.core.api.gt;

import java.math.BigInteger;
import java.util.UUID;

/**
 * One energy store at the moment of a scan. Amounts are {@link BigInteger} because GregTech's wireless
 * network and large Lapotronic Supercapacitors overflow a {@code long}. Never serialized as-is: the
 * {@code /gt/power} response turns them into decimal strings, since JSON numbers lose precision past 2^53
 * in a browser.
 */
public class GTPowerSourceSnapshot {

    public enum Kind {
        /** A Lapotronic Supercapacitor multiblock. */
        LSC,
        /** A team's wireless EU network. */
        WIRELESS
    }

    /** {@code lsc:dim:x:y:z} or {@code wireless:<team uuid>} - see {@link #lscId} and {@link #wirelessId}. */
    public String id;
    public Kind kind;
    public String name;
    public UUID owner;
    public String ownerName;

    /** EU stored; never {@code null}. */
    public BigInteger stored = BigInteger.ZERO;
    /** EU capacity; {@code null} when unbounded (wireless). */
    public BigInteger capacity;
    /** Average EU/t in, as the machine itself reports it; {@code null} when the source does not track it. */
    public Long avgInPerTick;
    /** Average EU/t out, as the machine itself reports it; {@code null} when the source does not track it. */
    public Long avgOutPerTick;

    /** Location, for an LSC; {@code null} for wireless. */
    public Integer dim;
    public Integer x;
    public Integer y;
    public Integer z;

    public static String lscId(int dim, int x, int y, int z) {
        return "lsc:" + GTMachineSnapshot.idOf(dim, x, y, z);
    }

    public static String wirelessId(UUID team) {
        return "wireless:" + team;
    }
}
