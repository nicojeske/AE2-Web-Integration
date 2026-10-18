import type { ComponentType } from "preact";

import type { IconProps } from "../ui/icons";
import {
    BoltIcon,
    ChartIcon,
    ClockIcon,
    ConveyorIcon,
    CpuIcon,
    FactoryIcon,
    FunnelIcon,
    GridIcon,
    StarIcon,
} from "../ui/icons";
import type { Section } from "./section";
import { isGTSection, SECTION_TITLES } from "./section";

export interface NavItem {
    section: Section;
    label: string;
    icon: ComponentType<IconProps>;
}

const ICONS: Record<Section, ComponentType<IconProps>> = {
    browser: GridIcon,
    jobs: CpuIcon,
    history: ClockIcon,
    favorites: StarIcon,
    stats: ChartIcon,
    bottlenecks: FunnelIcon,
    machines: FactoryIcon,
    power: BoltIcon,
    production: ConveyorIcon,
};

const ORDER: Section[] = [
    "browser",
    "jobs",
    "history",
    "favorites",
    "stats",
    "bottlenecks",
    "machines",
    "power",
    "production",
];

/** Every section this server has, in rail order - the GregTech ones only with `hasGT`. */
export function navItems(hasGT: boolean): NavItem[] {
    return ORDER.filter((s) => hasGT || !isGTSection(s)).map((section) => ({
        section,
        label: section === "browser" ? "Item Browser" : SECTION_TITLES[section],
        icon: ICONS[section],
    }));
}

/** The count pills on the rail and the phone tabs. */
export interface NavBadges {
    busyCount: number;
    lowStockFavCount: number;
    gtProblemCount: number;
}

export function badgeFor(
    section: Section,
    badges: NavBadges,
): { count: number; tone: "green" | "red"; title: string } | null {
    if (section === "jobs" && badges.busyCount > 0) {
        return { count: badges.busyCount, tone: "green", title: `${badges.busyCount} crafting` };
    }
    if (section === "favorites" && badges.lowStockFavCount > 0) {
        return {
            count: badges.lowStockFavCount,
            tone: "red",
            title: `${badges.lowStockFavCount} below their stock rule`,
        };
    }
    if (section === "machines" && badges.gtProblemCount > 0) {
        const n = badges.gtProblemCount;
        return { count: n, tone: "red", title: `${n} machine${n === 1 ? "" : "s"} need attention` };
    }
    return null;
}
