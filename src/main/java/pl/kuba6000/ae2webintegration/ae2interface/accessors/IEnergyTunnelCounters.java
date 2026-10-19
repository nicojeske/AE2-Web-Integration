package pl.kuba6000.ae2webintegration.ae2interface.accessors;

/**
 * Running totals an EU P2P input keeps since it was loaded ({@code PartP2PGT5PowerCounterMixin}); the GregTech scan
 * reads them and core turns the change between scans into rates.
 */
public interface IEnergyTunnelCounters {

    long web$euAccepted();

    long web$packetsAccepted();

    long web$ticksMaxed();

    long web$voltage();
}
