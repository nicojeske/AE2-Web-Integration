import { useEffect, useState } from "preact/hooks";

import { formatAgeShort, formatNumber } from "../api/format";
import type { CpuView } from "../state/cpus";
import { CpuLeds } from "../ui/CpuLeds";
import { usePopover } from "../ui/usePopover";
import { NetworkMenu } from "./NetworkMenu";

/** Beyond this many CPUs the LED strip would crowd out the command bar - the count still covers all of them. */
const MAX_LEDS = 16;

export interface TopbarProps {
    /** The GT pages aren't grid-scoped, so the network chip is disabled there. */
    networkDisabled: boolean;
    itemCount: number;
    onOpenPalette: () => void;
    cpus: CpuView[];
    onOpenJobs: () => void;
    /** When the data this page shows was fetched, or `null` when it has no single age (the GT pages). */
    syncedAt: number | null;
    onRefresh: () => void;
    username: string;
    isAdmin: boolean;
    onOpenSettings: () => void;
    onLogout: () => void;
}

export function Topbar({
    networkDisabled,
    itemCount,
    onOpenPalette,
    cpus,
    onOpenJobs,
    syncedAt,
    onRefresh,
    username,
    isAdmin,
    onOpenSettings,
    onLogout,
}: TopbarProps) {
    const busy = cpus.filter((c) => c.isBusy).length;
    const stalled = cpus.filter((c) => c.isBusy && c.stalledSince > 0).length;
    const account = usePopover();

    return (
        <header className="topbar">
            <div className="topbar__left">
                <span className="brand" aria-label="AE2 Terminal">
                    <span className="brand__mark" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                    </span>
                    <span className="brand__name">AE2</span>
                </span>
                <NetworkMenu disabled={networkDisabled} />
            </div>

            <div className="topbar__center">
                <button type="button" className="command-trigger" onClick={onOpenPalette} aria-keyshortcuts="Control+K">
                    <span className="command-trigger__prompt">›</span>
                    <span className="command-trigger__text">
                        Search {itemCount > 0 ? `${formatNumber(itemCount, "full")} items, ` : ""}CPUs and actions
                    </span>
                    <kbd className="kbd">Ctrl K</kbd>
                </button>
            </div>

            <div className="topbar__right">
                {cpus.length > 0 && (
                    <button
                        type="button"
                        className="topbar__cpus"
                        onClick={onOpenJobs}
                        title={`${busy} of ${cpus.length} CPUs crafting${stalled ? `, ${stalled} stalled` : ""}`}
                    >
                        <span className="topbar__cpus-label">CPU</span>
                        <CpuLeds cpus={cpus.slice(0, MAX_LEDS)} />
                        <span className="topbar__cpus-count">
                            {busy}/{cpus.length}
                        </span>
                    </button>
                )}
                {syncedAt !== null && <SyncedAge at={syncedAt} onRefresh={onRefresh} />}
                <div className="account" ref={account.ref}>
                    <button
                        type="button"
                        className="account__avatar"
                        aria-haspopup="menu"
                        aria-expanded={account.open}
                        title={username}
                        onClick={() => account.setOpen((o) => !o)}
                    >
                        {username.slice(0, 1).toUpperCase()}
                    </button>
                    {account.open && (
                        <div className="account__menu" role="menu">
                            <div className="account__who">
                                <span className="account__name">{username}</span>
                                <span className="account__role">{isAdmin ? "Administrator" : "Logged in"}</span>
                            </div>
                            <MenuItem
                                label="Refresh"
                                onClick={() => {
                                    account.setOpen(false);
                                    onRefresh();
                                }}
                            />
                            <MenuItem
                                label="Settings"
                                onClick={() => {
                                    account.setOpen(false);
                                    onOpenSettings();
                                }}
                            />
                            <MenuItem label="Log out" onClick={onLogout} danger />
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

/** "synced 4s", ticking on its own so the whole shell doesn't re-render every second. */
function SyncedAge({ at, onRefresh }: { at: number; onRefresh: () => void }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => {
            if (!document.hidden) setNow(Date.now());
        }, 1000);
        return () => clearInterval(id);
    }, []);
    return (
        <button type="button" className="topbar__synced" onClick={onRefresh} title="Refresh now">
            synced {formatAgeShort(at, now)}
        </button>
    );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
    return (
        <button
            type="button"
            role="menuitem"
            className={danger ? "chip-menu__option account__danger" : "chip-menu__option"}
            onClick={onClick}
        >
            {label}
        </button>
    );
}
