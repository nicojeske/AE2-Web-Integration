package pl.kuba6000.ae2webintegration.ae2interface.gt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;

import org.junit.jupiter.api.Test;

import pl.kuba6000.ae2webintegration.ae2interface.gt.GTStatusMapper.Input;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTStatusMapper.Reason;
import pl.kuba6000.ae2webintegration.ae2interface.gt.GTStatusMapper.Result;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;

class GTStatusMapperTest {

    /** A formed, enabled, fully maintained, idle machine. */
    private static Input healthy() {
        Input in = new Input();
        in.formed = true;
        in.maintenanceEnabled = true;
        in.wrench = in.screwdriver = in.softMallet = in.hardHammer = in.solderingTool = in.crowbar = true;
        in.allowedToWork = true;
        return in;
    }

    @Test
    void structureIncompleteWinsOverEverything() {
        Input in = healthy();
        in.formed = false;
        in.wrench = false;
        in.allowedToWork = false;
        in.reason = Reason.POWER;
        assertEquals(GTMachineStatus.STRUCTURE_INCOMPLETE, GTStatusMapper.map(in).status);
    }

    @Test
    void maintenanceListsMissingToolsInOrder() {
        Input in = healthy();
        in.crowbar = false;
        in.wrench = false;
        in.maxProgressTicks = 100;
        Result r = GTStatusMapper.map(in);
        assertEquals(GTMachineStatus.MAINTENANCE, r.status);
        assertEquals(Arrays.asList("Wrench", "Crowbar"), GTStatusMapper.maintenanceIssues(in));
    }

    @Test
    void maintenanceIgnoredWhenDisabled() {
        Input in = healthy();
        in.maintenanceEnabled = false;
        in.wrench = in.screwdriver = in.softMallet = in.hardHammer = in.solderingTool = in.crowbar = false;
        assertTrue(
            GTStatusMapper.maintenanceIssues(in)
                .isEmpty());
        assertEquals(GTMachineStatus.IDLE, GTStatusMapper.map(in).status);
    }

    @Test
    void shutdownReasonsMapToTheirStatus() {
        assertStopped(Reason.POWER, GTMachineStatus.NO_POWER);
        assertStopped(Reason.OUTPUT, GTMachineStatus.OUTPUT_FULL);
        assertStopped(Reason.OTHER, GTMachineStatus.STOPPED);
    }

    private static void assertStopped(Reason reason, GTMachineStatus expected) {
        Input in = healthy();
        in.allowedToWork = false;
        in.reason = reason;
        in.reasonDisplay = "why";
        Result r = GTStatusMapper.map(in);
        assertEquals(expected, r.status);
        assertEquals("why", r.detail);
    }

    @Test
    void powerAndOutputShutdownsBeatMaintenance() {
        Input in = healthy();
        in.wrench = false;
        in.allowedToWork = false;
        in.reason = Reason.POWER;
        in.reasonDisplay = "Power loss";
        Result r = GTStatusMapper.map(in);
        assertEquals(GTMachineStatus.NO_POWER, r.status);
        assertEquals("Power loss", r.detail);
        assertEquals(Arrays.asList("Wrench"), GTStatusMapper.maintenanceIssues(in));
        in.reason = Reason.OUTPUT;
        assertEquals(GTMachineStatus.OUTPUT_FULL, GTStatusMapper.map(in).status);
    }

    @Test
    void maintenanceBeatsOtherShutdowns() {
        Input in = healthy();
        in.wrench = false;
        in.allowedToWork = false;
        in.reason = Reason.OTHER;
        assertEquals(GTMachineStatus.MAINTENANCE, GTStatusMapper.map(in).status);
    }

    @Test
    void noRepairStopIsMaintenance() {
        Input in = healthy();
        in.allowedToWork = false;
        in.reason = Reason.MAINTENANCE;
        assertEquals(GTMachineStatus.MAINTENANCE, GTStatusMapper.map(in).status);
    }

    @Test
    void disabledWithoutReason() {
        Input in = healthy();
        in.allowedToWork = false;
        in.maxProgressTicks = 100;
        Result r = GTStatusMapper.map(in);
        assertEquals(GTMachineStatus.DISABLED, r.status);
        assertEquals("Disabled", r.detail);
    }

    @Test
    void runningOnProgressOrActive() {
        Input in = healthy();
        in.maxProgressTicks = 100;
        assertEquals(GTMachineStatus.RUNNING, GTStatusMapper.map(in).status);
        in = healthy();
        in.active = true;
        Result r = GTStatusMapper.map(in);
        assertEquals(GTMachineStatus.RUNNING, r.status);
        assertNull(r.detail);
    }

    @Test
    void idleCarriesFailedRecipeCheck() {
        Input in = healthy();
        assertNull(GTStatusMapper.map(in).detail);
        in.failedRecipeCheck = "No valid recipe found";
        Result r = GTStatusMapper.map(in);
        assertEquals(GTMachineStatus.IDLE, r.status);
        assertEquals("No valid recipe found", r.detail);
    }
}
