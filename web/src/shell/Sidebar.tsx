import type { ComponentType } from "preact";

import { useNetwork } from "../state/network";
import type { GridSelection } from "../state/network";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import type { IconProps } from "../ui/icons";
import { ChartIcon, ClockIcon, CpuIcon, GridIcon, StarIcon } from "../ui/icons";
import { gridMetaLine, gridOptionLabel } from "./gridLabel";
import type { Section } from "./section";

export interface SidebarProps {
    section: Section;
    onSectionChange: (section: Section) => void;
    busyCount: number;
    lowStockFavCount: number;
    notifyEnabled: boolean;
    onToggleNotify: () => void;
    username: string;
    isAdmin: boolean;
    onLogout: () => void;
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
    notifyEnabled,
    onToggleNotify,
    username,
    isAdmin,
    onLogout,
}: SidebarProps) {
    const { grids, selected, selectedGrid, selectGrid } = useNetwork();

    return (
        <aside className="sidebar">
            <div className="sidebar__brand">
                <div className="sidebar__brand-mark" />
                <span className="sidebar__brand-name">AE2 TERMINAL</span>
            </div>

            <div className="sidebar__network">
                <label className="sidebar__network-label" htmlFor="network-select">
                    Network
                </label>
                <select
                    id="network-select"
                    className="sidebar__network-select"
                    value={String(selected)}
                    onChange={(e) => {
                        const value = (e.target as HTMLSelectElement).value;
                        const next: GridSelection = value === "all" ? "all" : Number(value);
                        selectGrid(next);
                    }}
                >
                    <option value="all">All Grids</option>
                    {grids.map((g) => (
                        <option key={g.key} value={g.key} disabled={g.key === -1}>
                            {gridOptionLabel(g, grids)}
                        </option>
                    ))}
                </select>
                <span className="sidebar__network-meta">{gridMetaLine(selected, grids, selectedGrid)}</span>
            </div>

            <nav className="sidebar__nav">
                {NAV_ITEMS.map(({ section: itemSection, label, icon: Icon }) => (
                    <button
                        key={itemSection}
                        type="button"
                        className={cx("nav-item", itemSection === section && "nav-item--active")}
                        onClick={() => onSectionChange(itemSection)}
                    >
                        <Icon className="nav-item__icon" />
                        {label}
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
                <div className="sidebar__notify">
                    <Checkbox checked={notifyEnabled} onChange={onToggleNotify}>
                        <span className="sidebar__notify-label">Notify on job completion</span>
                    </Checkbox>
                </div>
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
        </aside>
    );
}
