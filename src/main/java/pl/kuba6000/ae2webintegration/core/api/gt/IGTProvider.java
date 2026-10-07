package pl.kuba6000.ae2webintegration.core.api.gt;

/**
 * GregTech data source, implemented by a Minecraft-version branch that has GregTech available (today only
 * {@code 1.7.10}) and handed to core through
 * {@link pl.kuba6000.ae2webintegration.core.api.IAEWebInterface#registerGTProvider}.
 * <p>
 * Core never touches GregTech itself. It calls {@link #scan} on the server thread at the configured
 * interval and keeps everything else - last-seen machines, power history, production totals, visibility -
 * on its side. A branch without GregTech simply never registers a provider, and every {@code /api/gt/*}
 * endpoint answers {@code NOT_AVAILABLE}.
 */
public interface IGTProvider {

    /**
     * Snapshots every GregTech multiblock and power source currently loaded. Always called on the server
     * thread, from the server tick, so it may read live tile entities freely - but it runs inside the tick,
     * so it must stay cheap (one pass over the loaded tile entities, no chunk loading).
     *
     * @param nowMillis wall clock of this scan, for anything the provider wants to timestamp itself
     * @return never {@code null}
     */
    GTScanResult scan(long nowMillis);
}
