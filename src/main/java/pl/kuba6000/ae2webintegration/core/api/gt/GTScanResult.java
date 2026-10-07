package pl.kuba6000.ae2webintegration.core.api.gt;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** One {@link IGTProvider#scan} pass. Every collection is non-null; an empty scan is a valid result. */
public class GTScanResult {

    /** Every loaded multiblock. Machines absent from a scan are kept by core as "not loaded", not dropped. */
    public List<GTMachineSnapshot> machines = new ArrayList<>();

    /** Every power source: loaded Lapotronic Supercapacitors and the wireless EU network of each team. */
    public List<GTPowerSourceSnapshot> powerSources = new ArrayList<>();

    /**
     * Player UUID to team UUID (the GregTech team leader), for every owner seen in this scan and every
     * online player. Core merges it into what it already knows, so a player who logged off keeps their
     * team. A player missing from it is treated as a team of one.
     */
    public Map<UUID, UUID> teams = new HashMap<>();

    /** Player UUID to current name, for owners the provider could resolve. Optional. */
    public Map<UUID, String> playerNames = new HashMap<>();
}
