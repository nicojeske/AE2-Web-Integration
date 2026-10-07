package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.util.ArrayList;
import java.util.List;

import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;

/**
 * Derives a machine's {@link GTMachineStatus} from plain values read off the multiblock. Deliberately free of
 * GregTech types so the rules can be tested without a world; {@link GTProvider} does the reading.
 */
public final class GTStatusMapper {

    /** GregTech's last shutdown reason, sorted into the buckets the status rules care about. */
    public enum Reason {
        /** {@code NONE} / {@code CRITICAL_NONE}: no recorded reason. */
        NONE,
        /** {@code POWER_LOSS} / {@code INSUFFICIENT_DYNAMO}. */
        POWER,
        /** {@code ITEM_OUTPUT_FAILED} / {@code FLUID_OUTPUT_FAILED}. */
        OUTPUT,
        /** Anything else. */
        OTHER
    }

    /** What the rules read from one machine. */
    public static final class Input {

        public boolean formed;
        /** Maintenance checks apply to this machine (not globally disabled, not exempt). */
        public boolean maintenanceEnabled;
        public boolean wrench, screwdriver, softMallet, hardHammer, solderingTool, crowbar;
        public boolean allowedToWork;
        public boolean active;
        public Reason reason = Reason.NONE;
        public String reasonDisplay;
        public int maxProgressTicks;
        /** Display string of the last recipe check when it failed for a real reason, else {@code null}. */
        public String failedRecipeCheck;
    }

    public static final class Result {

        public final GTMachineStatus status;
        public final String detail;

        Result(GTMachineStatus status, String detail) {
            this.status = status;
            this.detail = detail;
        }
    }

    private GTStatusMapper() {}

    /** Display names of the missing tools; empty when maintenance does not apply. */
    public static List<String> maintenanceIssues(Input in) {
        List<String> issues = new ArrayList<>();
        if (!in.maintenanceEnabled) return issues;
        if (!in.wrench) issues.add("Wrench");
        if (!in.screwdriver) issues.add("Screwdriver");
        if (!in.softMallet) issues.add("Soft Mallet");
        if (!in.hardHammer) issues.add("Hard Hammer");
        if (!in.solderingTool) issues.add("Soldering Tool");
        if (!in.crowbar) issues.add("Crowbar");
        return issues;
    }

    /** First matching rule wins; see docs/gt-hub/phase-3-adapter-1.7.10.md §3. */
    public static Result map(Input in) {
        if (!in.formed) return new Result(GTMachineStatus.STRUCTURE_INCOMPLETE, "Structure incomplete");
        if (!maintenanceIssues(in).isEmpty()) return new Result(GTMachineStatus.MAINTENANCE, "Maintenance required");
        if (!in.allowedToWork) {
            switch (in.reason) {
                case POWER:
                    return new Result(GTMachineStatus.NO_POWER, in.reasonDisplay);
                case OUTPUT:
                    return new Result(GTMachineStatus.OUTPUT_FULL, in.reasonDisplay);
                case OTHER:
                    return new Result(GTMachineStatus.STOPPED, in.reasonDisplay);
                default:
                    return new Result(GTMachineStatus.DISABLED, "Disabled");
            }
        }
        if (in.maxProgressTicks > 0 || in.active) return new Result(GTMachineStatus.RUNNING, null);
        return new Result(GTMachineStatus.IDLE, in.failedRecipeCheck);
    }
}
