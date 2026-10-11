// Below 768px: a one-line CPU strip and a bottom tab bar (Items, Crafting, Favorites, More), where
// "More" opens a sheet with the remaining sections, Settings and Log out.
import { useState } from "preact/hooks";

import { skipSpecialFormat } from "../api/format";
import type { CpuView } from "../state/cpus";
import { CpuLeds, cpuRank } from "../ui/CpuLeds";
import { cx } from "../ui/cx";
import { Drawer } from "../ui/Drawer";
import { GearIcon, MenuIcon } from "../ui/icons";
import { ItemIcon } from "../ui/ItemIcon";
import type { NavBadges } from "./nav";
import { badgeFor, navItems } from "./nav";
import type { Section } from "./section";

const TABS: Section[] = ["browser", "jobs", "favorites"];
const SHORT: Partial<Record<Section, string>> = { browser: "Items", jobs: "Crafting", stats: "Stats" };

export interface PhoneNavProps {
    section: Section;
    onSectionChange: (section: Section) => void;
    hasGT: boolean;
    badges: NavBadges;
    cpus: CpuView[];
    onOpenSettings: () => void;
    onLogout: () => void;
}

export function PhoneNav({ section, onSectionChange, hasGT, badges, cpus, onOpenSettings, onLogout }: PhoneNavProps) {
    const [moreOpen, setMoreOpen] = useState(false);
    const items = navItems(hasGT);
    const tabs = items.filter((i) => TABS.includes(i.section));
    const more = items.filter((i) => !TABS.includes(i.section));
    const busy = cpus.filter((c) => c.isBusy);
    const stalled = busy.filter((c) => c.stalledSince > 0).length;
    const top = [...busy].sort((a, b) => cpuRank(a) - cpuRank(b))[0];

    const go = (s: Section) => {
        setMoreOpen(false);
        onSectionChange(s);
    };

    return (
        <div className="phone-nav">
            {busy.length > 0 && (
                <button type="button" className="phone-nav__cpus" onClick={() => go("jobs")}>
                    <CpuLeds cpus={cpus.slice(0, 12)} small />
                    <span className="phone-nav__cpus-text">
                        {busy.length} crafting
                        {stalled > 0 && <span className="phone-nav__stalled"> · {stalled} stalled</span>}
                    </span>
                    {top?.finalOutput && (
                        <>
                            <ItemIcon
                                itemid={top.finalOutput.itemid}
                                name={top.finalOutput.itemname}
                                size={18}
                                className="phone-nav__cpus-icon"
                            />
                            <span className="phone-nav__cpus-top">
                                {skipSpecialFormat(top.finalOutput.itemname)}
                                {top.progressPct !== null ? ` ${top.progressPct}%` : ""}
                            </span>
                        </>
                    )}
                </button>
            )}
            <nav className="phone-nav__tabs" aria-label="Sections">
                {tabs.map(({ section: item, icon: Icon, label }) => {
                    const badge = badgeFor(item, badges);
                    return (
                        <button
                            key={item}
                            type="button"
                            aria-current={item === section ? "page" : undefined}
                            className={cx("phone-nav__tab", item === section && "phone-nav__tab--active")}
                            onClick={() => go(item)}
                        >
                            <Icon />
                            <span>{SHORT[item] ?? label}</span>
                            {badge && <span className={`rail__pill rail__pill--${badge.tone}`}>{badge.count}</span>}
                        </button>
                    );
                })}
                <button
                    type="button"
                    className={cx(
                        "phone-nav__tab",
                        more.some((m) => m.section === section) && "phone-nav__tab--active",
                    )}
                    onClick={() => setMoreOpen(true)}
                >
                    <MenuIcon />
                    <span>More</span>
                </button>
            </nav>
            {moreOpen && (
                <Drawer title="More" side="bottom" onClose={() => setMoreOpen(false)}>
                    <div className="phone-more">
                        {more.map(({ section: item, icon: Icon, label }) => {
                            const badge = badgeFor(item, badges);
                            return (
                                <button
                                    key={item}
                                    type="button"
                                    className={cx("phone-more__item", item === section && "phone-more__item--active")}
                                    onClick={() => go(item)}
                                >
                                    <Icon />
                                    <span>{label}</span>
                                    {badge && (
                                        <span className={`rail__pill rail__pill--${badge.tone}`}>{badge.count}</span>
                                    )}
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            className="phone-more__item"
                            onClick={() => {
                                setMoreOpen(false);
                                onOpenSettings();
                            }}
                        >
                            <GearIcon />
                            <span>Settings</span>
                        </button>
                        <button type="button" className="phone-more__item phone-more__item--danger" onClick={onLogout}>
                            <span className="phone-more__spacer" />
                            <span>Log out</span>
                        </button>
                    </div>
                </Drawer>
            )}
        </div>
    );
}
