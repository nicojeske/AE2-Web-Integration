import { Button } from "../ui/Button";
import { GearIcon, MenuIcon } from "../ui/icons";
import { NetworkPicker } from "./NetworkPicker";
import { SECTION_TITLES } from "./section";
import type { Section } from "./section";

export interface TopbarProps {
    section: Section;
    search?: string;
    onSearchChange?: (value: string) => void;
    onRefresh: () => void;
    /** <768px only - opens Sidebar's off-canvas Drawer (hidden via CSS elsewhere, see app-shell.css). */
    onToggleNav: () => void;
    /** "updated Ns ago" for the currently loaded items, or `null` while nothing's loaded yet. */
    updatedLabel: string | null;
    onOpenSettings: () => void;
}

export function Topbar({
    section,
    search,
    onSearchChange,
    onRefresh,
    onToggleNav,
    updatedLabel,
    onOpenSettings,
}: TopbarProps) {
    return (
        <div className="topbar">
            <Button
                variant="icon"
                className="topbar__nav-toggle"
                onClick={onToggleNav}
                aria-label="Open menu"
                title="Menu"
            >
                <MenuIcon size={18} />
            </Button>
            <h1 className="topbar__title">{SECTION_TITLES[section]}</h1>
            <NetworkPicker className="topbar__network" variant="topbar" />
            {section === "browser" && onSearchChange && (
                <input
                    type="text"
                    className="topbar__search"
                    placeholder="Search items and fluids..."
                    title="@mod filters by mod, -word excludes, >100 filters by minimum quantity"
                    value={search ?? ""}
                    onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
                />
            )}
            <div className="topbar__actions">
                {updatedLabel && <span className="topbar__updated">{updatedLabel}</span>}
                <Button variant="secondary" onClick={onRefresh}>
                    Refresh
                </Button>
                <Button variant="icon" onClick={onOpenSettings} aria-label="Settings" title="Settings">
                    <GearIcon size={16} />
                </Button>
            </div>
        </div>
    );
}
