import type { ComponentChildren, ComponentType } from "preact";

import { cx } from "../ui/cx";
import { Drawer } from "../ui/Drawer";
import type { IconProps } from "../ui/icons";
import { ChartIcon, ClockIcon, CpuIcon, GridIcon, StarIcon } from "../ui/icons";
import { NetworkPicker } from "./NetworkPicker";
import type { Section } from "./section";

export interface SidebarProps {
    section: Section;
    onSectionChange: (section: Section) => void;
    busyCount: number;
    lowStockFavCount: number;
    username: string;
    isAdmin: boolean;
    onLogout: () => void;
    /** <768px only: the off-canvas drawer replacing the (CSS-hidden) inline sidebar - see app-shell.css. */
    mobileOpen: boolean;
    onCloseMobile: () => void;
}

const NAV_ITEMS: { section: Section; label: string; icon: ComponentType<IconProps> }[] = [
    { section: "browser", label: "Item Browser", icon: GridIcon },
    { section: "jobs", label: "Active Jobs", icon: CpuIcon },
    { section: "history", label: "History", icon: ClockIcon },
    { section: "favorites", label: "Favorites", icon: StarIcon },
    { section: "stats", label: "Statistics", icon: ChartIcon },
];

export function Sidebar({
    section,
    onSectionChange,
    busyCount,
    lowStockFavCount,
    username,
    isAdmin,
    onLogout,
    mobileOpen,
    onCloseMobile,
}: SidebarProps) {
    // Shared between the persistent aside (>=768px, an icon rail below 1024px - see app-shell.css) and
    // the <768px off-canvas Drawer, so the two never drift out of sync with each other.
    const body: ComponentChildren = (
        <>
            <NetworkPicker className="sidebar__network" />

            <nav className="sidebar__nav">
                {NAV_ITEMS.map(({ section: itemSection, label, icon: Icon }) => (
                    <button
                        key={itemSection}
                        type="button"
                        title={label}
                        className={cx("nav-item", itemSection === section && "nav-item--active")}
                        onClick={() => {
                            onSectionChange(itemSection);
                            onCloseMobile();
                        }}
                    >
                        <Icon className="nav-item__icon" />
                        <span className="nav-item__label">{label}</span>
                        {itemSection === "jobs" && busyCount > 0 && (
                            <span className="nav-item__pill nav-item__pill--busy">{busyCount}</span>
                        )}
                        {itemSection === "favorites" && lowStockFavCount > 0 && (
                            <span className="nav-item__pill nav-item__pill--low-stock">{lowStockFavCount}</span>
                        )}
                    </button>
                ))}
            </nav>

            <div className="sidebar__footer">
                <div className="sidebar__account">
                    <div className="sidebar__avatar">{username.slice(0, 1).toUpperCase()}</div>
                    <div className="sidebar__account-info">
                        <span className="sidebar__account-name">{username}</span>
                        <span className="sidebar__account-role">{isAdmin ? "Administrator" : "Logged in"}</span>
                    </div>
                    <button type="button" className="btn btn--text" onClick={onLogout}>
                        Log out
                    </button>
                </div>
            </div>
        </>
    );

    return (
        <>
            <aside className="sidebar">
                <div className="sidebar__brand">
                    <div className="sidebar__brand-mark" />
                    <span className="sidebar__brand-name">AE2 TERMINAL</span>
                </div>
                {body}
            </aside>
            {mobileOpen && (
                <Drawer side="left" title="AE2 Terminal" onClose={onCloseMobile}>
                    {body}
                </Drawer>
            )}
        </>
    );
}
