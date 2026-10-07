package pl.kuba6000.ae2webintegration.core.ae2request.async.gt;

import java.util.Map;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.gt.GTMachineRegistry;
import pl.kuba6000.ae2webintegration.core.gt.GTVisibility;

/**
 * {@code /gt/machine?id=<dim:x:y:z>[&range=24h]}: one machine plus what it produced over the range. An
 * invisible machine answers {@code NOT_FOUND}, same as a missing one, so ids cannot be probed.
 */
public class GetGTMachine extends GTRequest {

    public static class JSON_GTMachine {

        public GTMachineSnapshot machine;
        public GetGTProduction.JSON_GTProduction production;
    }

    @Override
    protected void handleGT(Map<String, String> getParams, WebPrincipal principal) {
        String id = getParams.get("id");
        if (id == null || id.isEmpty()) {
            noParam("id");
            return;
        }
        Long span = parseRange(getParams, "24h", GetGTProduction.maxRangeMillis());
        if (span == null) {
            deny("BAD_PARAM");
            return;
        }
        GTMachineSnapshot machine = GTMachineRegistry.get(id);
        if (machine == null || !GTVisibility.canSee(principal, machine.owner)) {
            deny("NOT_FOUND");
            return;
        }
        long now = System.currentTimeMillis();
        JSON_GTMachine result = new JSON_GTMachine();
        result.machine = machine;
        result.production = GetGTProduction.build(now - span, now, now, "item", id, principal);
        succeed(result);
    }
}
