package pl.kuba6000.ae2webintegration.core.api.gt;

/**
 * Coarse machine state, derived by the provider. Ordered from "needs attention" to "fine", which is the
 * order the web UI groups machines in - so declaration order is part of the contract.
 */
public enum GTMachineStatus {
    /** The multiblock structure is not formed. */
    STRUCTURE_INCOMPLETE,
    /** At least one maintenance issue is present. */
    MAINTENANCE,
    /** Shut down for lack of power. */
    NO_POWER,
    /** Shut down because output busses or hatches are full. */
    OUTPUT_FULL,
    /** Shut down for any other reason; {@link GTMachineSnapshot#statusDetail} says which. */
    STOPPED,
    /** Switched off by a player (soft mallet, cover, controller toggle). */
    DISABLED,
    /** Formed, enabled and healthy, but no recipe is running. */
    IDLE,
    /** Running a recipe. */
    RUNNING
}
