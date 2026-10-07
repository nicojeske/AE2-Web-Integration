package pl.kuba6000.ae2webintegration.core.ae2request.async.gt;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineStatus;
import pl.kuba6000.ae2webintegration.core.gt.GTEngine;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;

/** {@code /gt/machines}: every machine the caller may see, problems first. */
public class GetGTMachines extends GTRequest {

    public static class JSON_GTMachines {

        public long scannedAt;
        public long scanMicros;
        public int unloaded;
        /** Count per status, loaded machines only; every status is present, zero or not. */
        public Map<GTMachineStatus, Integer> summary = new EnumMap<>(GTMachineStatus.class);
        public List<GTMachineSnapshot> machines = new ArrayList<>();
    }

    /** Loaded before unloaded, then status in declaration order (problems first), then name, then id. */
    static final Comparator<GTMachineSnapshot> ORDER = Comparator.comparing((GTMachineSnapshot m) -> !m.loaded)
        .thenComparing(m -> m.status == null ? GTMachineStatus.STOPPED : m.status)
        .thenComparing(m -> m.name == null ? "" : m.name)
        .thenComparing(m -> m.id);

    @Override
    protected void handleGT(Map<String, String> getParams, WebPrincipal principal) {
        JSON_GTMachines result = new JSON_GTMachines();
        result.scannedAt = GTEngine.lastScanMillis();
        result.scanMicros = GTEngine.lastScanMicros();
        for (GTMachineStatus status : GTMachineStatus.values()) {
            result.summary.put(status, 0);
        }
        for (GTMachineSnapshot machine : GTMachineRegistry.all()) {
            if (!GTVisibility.canSee(principal, machine.owner)) {
                continue;
            }
            result.machines.add(machine);
            if (!machine.loaded) {
                result.unloaded++;
            } else if (machine.status != null) {
                result.summary.merge(machine.status, 1, Integer::sum);
            }
        }
        result.machines.sort(ORDER);
        succeed(result);
    }
}
