package pl.kuba6000.ae2webintegration.core.api.gt;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * One multiblock controller at the moment of a scan. Filled in by the provider, except the fields marked
 * as set by core. Also the wire shape of {@code /api/gt/machines}, so field names are part of the HTTP contract.
 */
public class GTMachineSnapshot {

    /** {@code dim:x:y:z} of the controller - see {@link #idOf}. Stable for as long as the machine stands. */
    public String id;
    public int dim;
    /** Dimension display name, e.g. "Overworld"; optional. */
    public String dimName;
    public int x;
    public int y;
    public int z;

    /** Localized machine name, e.g. "Electric Blast Furnace". */
    public String name;
    /** Unlocalized machine type, e.g. "multimachine.blastfurnace"; stable across languages, used for grouping. */
    public String type;

    public UUID owner;
    public String ownerName;

    public GTMachineStatus status;
    /** Human-readable reason behind {@link #status}, e.g. GregTech's shutdown reason; may be {@code null}. */
    public String statusDetail;

    /** Progress of the running recipe in ticks; 0 when idle. */
    public int progressTicks;
    public int maxProgressTicks;
    /** EU/t of the running recipe: positive = consumes, negative = generates. 0 when idle. */
    public long euPerTick;
    /** Voltage tier index as GregTech counts it (0 = ULV, 1 = LV, ... 5 = IV, 6 = LuV); -1 if unknown. */
    public int voltageTier = -1;
    /** 0..10000, GregTech's own scale (10000 = 100%). */
    public int efficiency;

    /** Display names of missing maintenance tools, e.g. "Wrench", "Soft Mallet"; empty when fine. */
    public List<String> maintenanceIssues = new ArrayList<>();
    /** Outputs of the recipe in progress; empty when idle. */
    public List<GTStack> outputs = new ArrayList<>();

    /** Set by core: when this machine was last part of a scan. */
    public long lastSeenMillis;
    /** Set by core: whether it was part of the most recent scan (its chunk is loaded). */
    public boolean loaded;

    public static String idOf(int dim, int x, int y, int z) {
        return dim + ":" + x + ":" + y + ":" + z;
    }

    /** Shallow copy, so core can flip {@link #loaded} without touching a snapshot a reader may hold. */
    public GTMachineSnapshot copy() {
        GTMachineSnapshot copy = new GTMachineSnapshot();
        copy.id = id;
        copy.dim = dim;
        copy.dimName = dimName;
        copy.x = x;
        copy.y = y;
        copy.z = z;
        copy.name = name;
        copy.type = type;
        copy.owner = owner;
        copy.ownerName = ownerName;
        copy.status = status;
        copy.statusDetail = statusDetail;
        copy.progressTicks = progressTicks;
        copy.maxProgressTicks = maxProgressTicks;
        copy.euPerTick = euPerTick;
        copy.voltageTier = voltageTier;
        copy.efficiency = efficiency;
        copy.maintenanceIssues = maintenanceIssues == null ? new ArrayList<>() : new ArrayList<>(maintenanceIssues);
        copy.outputs = outputs == null ? new ArrayList<>() : new ArrayList<>(outputs);
        copy.lastSeenMillis = lastSeenMillis;
        copy.loaded = loaded;
        return copy;
    }
}
