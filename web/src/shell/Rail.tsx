import { cx } from "../ui/cx";
import { GearIcon } from "../ui/icons";
import type { NavBadges } from "./nav";
import { badgeFor, navItems } from "./nav";
import type { Section } from "./section";

export interface RailProps {
    section: Section;
    onSectionChange: (section: Section) => void;
    hasGT: boolean;
    badges: NavBadges;
    onOpenSettings: () => void;
}

/** The 56px icon rail (768px and up; phones get `PhoneNav` instead). */
export function Rail({ section, onSectionChange, hasGT, badges, onOpenSettings }: RailProps) {
    return (
        <nav className="rail" aria-label="Sections">
            {navItems(hasGT).map(({ section: item, label, icon: Icon }) => {
                const badge = badgeFor(item, badges);
                return (
                    <button
                        key={item}
                        type="button"
                        title={badge ? `${label} · ${badge.title}` : label}
                        aria-label={label}
                        aria-current={item === section ? "page" : undefined}
                        className={cx("rail__item", item === section && "rail__item--active")}
                        onClick={() => onSectionChange(item)}
                    >
                        <Icon />
                        {badge && <span className={`rail__pill rail__pill--${badge.tone}`}>{badge.count}</span>}
                    </button>
                );
            })}
            <button
                type="button"
                className="rail__item rail__gear"
                title="Settings"
                aria-label="Settings"
                onClick={onOpenSettings}
            >
                <GearIcon />
            </button>
        </nav>
    );
}
