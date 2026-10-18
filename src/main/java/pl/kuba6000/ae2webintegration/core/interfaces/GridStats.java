package pl.kuba6000.ae2webintegration.core.interfaces;

import com.github.bsideup.jabel.Desugar;

/**
 * A grid's storage capacity and AE power, as the platform's own network status reports them. Bytes and types are
 * summed over the grid's storage cells (drives, chests); external storage such as storage buses has no capacity and
 * is not included. Power is in AE units: usage and injection per tick, stored and capacity in total.
 */
@Desugar
public record GridStats(long itemBytesUsed, long itemBytesTotal, long itemTypesUsed, long itemTypesTotal,
    long fluidBytesUsed, long fluidBytesTotal, long fluidTypesUsed, long fluidTypesTotal, double powerUsage,
    double powerInjection, double powerStored, double powerMax) {}
