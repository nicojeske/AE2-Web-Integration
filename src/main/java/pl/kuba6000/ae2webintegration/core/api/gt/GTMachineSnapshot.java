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

    /**
     * Why an {@link GTMachineStatus#IDLE} machine found nothing to run, as a stable lower-case id - GregTech's
     * recipe check result, e.g. {@code no_recipe}, {@code missing_item}, {@code insufficient_voltage}; {@code null}
     * when not idle or no check failed.
     */
    public String idleReason;
    /** Progress of the running recipe in ticks; 0 when idle. */
    public int progressTicks;
    public int maxProgressTicks;
    /** Parallels of the running recipe (batch mode included); 0 when idle or unknown. */
    public int parallels;
    /** Most parallels the machine may run at its current settings; 0 when it has no parallel limit to report. */
    public int maxParallels;
    /**
     * Duration of the running recipe as GregTech lists it, before overclocking, in ticks; 0 when unknown. Its ratio
     * to {@link #maxProgressTicks} is the speed-up the machine gets from overclocking.
     */
    public int baseDurationTicks;
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
    /**
     * What the recipe in progress took when it started (times its parallels); empty when idle, or when the
     * machine does not use GregTech's {@code ProcessingLogic} or started its recipe before a restart.
     */
    public List<GTStack> inputs = new ArrayList<>();

    /** Set by core: when this machine was last part of a scan. */
    public long lastSeenMillis;
    /** Set by core: whether it was part of the most recent scan (its chunk is loaded). */
    public boolean loaded;
    /** Set by core: when a scan first saw the machine in its current {@link #status}. */
    public long statusSinceMillis;

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
        copy.idleReason = idleReason;
        copy.progressTicks = progressTicks;
        copy.maxProgressTicks = maxProgressTicks;
        copy.parallels = parallels;
        copy.maxParallels = maxParallels;
        copy.baseDurationTicks = baseDurationTicks;
        copy.euPerTick = euPerTick;
        copy.voltageTier = voltageTier;
        copy.efficiency = efficiency;
        copy.maintenanceIssues = maintenanceIssues == null ? new ArrayList<>() : new ArrayList<>(maintenanceIssues);
        copy.outputs = outputs == null ? new ArrayList<>() : new ArrayList<>(outputs);
        copy.inputs = inputs == null ? new ArrayList<>() : new ArrayList<>(inputs);
        copy.lastSeenMillis = lastSeenMillis;
        copy.loaded = loaded;
        copy.statusSinceMillis = statusSinceMillis;
        return copy;
    }
}
