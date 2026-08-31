import { Button } from "../ui/Button";
import { SECTION_TITLES } from "./section";
import type { Section } from "./section";

export interface TopbarProps {
    section: Section;
    search?: string;
    onSearchChange?: (value: string) => void;
    onRefresh: () => void;
}

export function Topbar({ section, search, onSearchChange, onRefresh }: TopbarProps) {
    return (
        <div className="topbar">
            <h1 className="topbar__title">{SECTION_TITLES[section]}</h1>
            {section === "browser" && onSearchChange && (
                <input
                    type="text"
                    className="topbar__search"
                    placeholder="Search items and fluids..."
                    value={search ?? ""}
                    onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
                />
            )}
            <div className="topbar__actions">
                <Button variant="secondary" onClick={onRefresh}>
                    Refresh
                </Button>
            </div>
        </div>
    );
}
