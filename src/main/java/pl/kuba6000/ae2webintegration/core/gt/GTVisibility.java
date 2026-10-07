package pl.kuba6000.ae2webintegration.core.gt;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import pl.kuba6000.ae2webintegration.core.WebPrincipal;

/**
 * Who may see which GregTech data. Admin and localhost see everything. A player sees what they own and
 * what anyone on their GregTech team owns. Something without an owner is admin-only - fail closed.
 * <p>
 * Teams come from {@code GTScanResult.teams} and are merged, never replaced, so a player who logged off
 * keeps their team until a later scan says otherwise. Runtime only: after a restart the first scan
 * repopulates it.
 */
public final class GTVisibility {

    private static final ConcurrentHashMap<UUID, UUID> teams = new ConcurrentHashMap<>();

    private GTVisibility() {}

    static void mergeTeams(Map<UUID, UUID> observed) {
        if (observed == null) {
            return;
        }
        for (Map.Entry<UUID, UUID> entry : observed.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                teams.put(entry.getKey(), entry.getValue());
            }
        }
    }

    static UUID teamOf(UUID player) {
        return teams.getOrDefault(player, player);
    }

    public static boolean canSee(WebPrincipal principal, UUID owner) {
        if (principal == null) {
            return false;
        }
        if (principal.isAdmin()) {
            return true;
        }
        if (owner == null || principal.getPlayerIdentity() == null) {
            return false;
        }
        UUID viewer = principal.getPlayerIdentity().uuid;
        return owner.equals(viewer) || teamOf(owner).equals(teamOf(viewer));
    }

    static void clear() {
        teams.clear();
    }
}
