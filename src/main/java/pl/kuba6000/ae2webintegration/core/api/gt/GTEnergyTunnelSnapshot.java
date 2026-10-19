package pl.kuba6000.ae2webintegration.core.api.gt;

import java.util.UUID;

/**
 * The input side of one EU P2P tunnel (GregTech's "ME P2P Tunnel - GT EU") at the moment of a scan. The counters
 * are running totals the provider keeps on the part since it was loaded; core turns the change between two scans
 * into a rate, and treats a counter that went down (the part was unloaded and reloaded) as a fresh start.
 */
public class GTEnergyTunnelSnapshot {

    /** {@code p2p:dim:x:y:z:side} - see {@link #idOf}. */
    public String id;
    /** The part's custom name; {@code null} when it has none. */
    public String name;
    public UUID owner;
    public String ownerName;
    /** P2P frequency the input and its outputs share. */
    public long frequency;
    /** Outputs bound to this input. */
    public int outputs;

    /** EU the tunnel accepted since the part was loaded. */
    public long euAccepted;
    /** Packets (amps) the tunnel accepted since the part was loaded. */
    public long packetsAccepted;
    /**
     * Ticks in which the outputs took every amp the cable offered the tunnel: demand reached what the line feeding it
     * delivers. Often above zero means the line is maxed out.
     */
    public long ticksMaxed;
    /** Voltage of the last packet offered to the tunnel, 0 before the first one. */
    public long voltage;

    public int dim;
    public String dimName;
    public int x;
    public int y;
    public int z;
    /** Side of the cable bus the part sits on, as a lower-case direction name. */
    public String side;

    public static String idOf(int dim, int x, int y, int z, String side) {
        return "p2p:" + GTMachineSnapshot.idOf(dim, x, y, z) + ":" + side;
    }
}
