export type Section = "browser" | "jobs" | "history" | "favorites" | "stats" | "machines" | "power" | "production";

export const SECTION_TITLES: Record<Section, string> = {
    browser: "Item Browser",
    jobs: "Active Jobs",
    history: "Crafting History",
    favorites: "Favorites",
    stats: "Statistics",
    machines: "Machines",
    power: "Power",
    production: "Production",
};

/** The GregTech hub sections - shown only with `hasGT`, and not grid-scoped (no `?grid=`, no network picker). */
export const GT_SECTIONS: readonly Section[] = ["machines", "power", "production"];

export function isGTSection(section: Section): boolean {
    return GT_SECTIONS.includes(section);
}
