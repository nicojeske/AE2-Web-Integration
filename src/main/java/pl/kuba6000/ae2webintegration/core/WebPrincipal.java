package pl.kuba6000.ae2webintegration.core;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.UUID;

import pl.kuba6000.ae2webintegration.core.api.PlayerIdentity;

/**
 * Stable identity authenticated by the web layer.
 * <p>
 * A player's UUID is the account identity. The username is retained only as the canonical display and
 * login name, so a rename does not create a second authorization cache entry. Administrator and trusted
 * localhost access are explicit principals instead of magic AE2 player ids.
 */
public final class WebPrincipal {

    private enum Kind {
        PLAYER,
        ADMIN,
        LOCALHOST
    }

    private static final WebPrincipal ADMIN = new WebPrincipal(Kind.ADMIN, null, "Admin");
    private static final WebPrincipal LOCALHOST = new WebPrincipal(Kind.LOCALHOST, null, "localhost");

    /**
     * Storage key for ADMIN/LOCALHOST in any map keyed by player UUID (currently just synced prefs -
     * {@link PlayerPrefsHandler}) - both share this one key since they share the single admin account
     * concept in single-admin-password mode, and neither has a player identity of its own to key by.
     */
    private static final UUID ADMIN_PREFS_UUID = UUID
        .nameUUIDFromBytes("AE2-WEB-INTEGRATION-ADMIN-PREFS".getBytes(StandardCharsets.UTF_8));

    private final Kind kind;
    private final PlayerIdentity playerIdentity;
    private final String username;

    private WebPrincipal(Kind kind, PlayerIdentity playerIdentity, String username) {
        this.kind = kind;
        this.playerIdentity = playerIdentity;
        this.username = username;
    }

    public static WebPrincipal forPlayer(PlayerIdentity identity) {
        Objects.requireNonNull(identity, "identity");
        Objects.requireNonNull(identity.uuid, "identity.uuid");
        Objects.requireNonNull(identity.name, "identity.name");
        return new WebPrincipal(Kind.PLAYER, identity, identity.name);
    }

    public static WebPrincipal admin() {
        return ADMIN;
    }

    public static WebPrincipal localhost() {
        return LOCALHOST;
    }

    public boolean isAdmin() {
        return kind != Kind.PLAYER;
    }

    public PlayerIdentity getPlayerIdentity() {
        return playerIdentity;
    }

    public String getUsername() {
        return username;
    }

    /** @see #ADMIN_PREFS_UUID */
    public UUID prefsKey() {
        return kind == Kind.PLAYER ? playerIdentity.uuid : ADMIN_PREFS_UUID;
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof WebPrincipal)) {
            return false;
        }
        WebPrincipal other = (WebPrincipal) object;
        if (kind != other.kind) {
            return false;
        }
        return kind != Kind.PLAYER || playerIdentity.uuid.equals(other.playerIdentity.uuid);
    }

    @Override
    public int hashCode() {
        return kind == Kind.PLAYER ? 31 * kind.hashCode() + playerIdentity.uuid.hashCode() : kind.hashCode();
    }
}
