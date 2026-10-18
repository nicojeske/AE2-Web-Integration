// The command palette's query parsing and result building - pure, so the palette component only renders
// and runs what this returns.
import { formatBytes, formatNumber, skipSpecialFormat } from "../api/format";
import type { CpuView } from "../state/cpus";
import type { BrowserItem } from "../state/items";
import { cpuRank } from "../ui/CpuLeds";
import { filterItems } from "../views/browserModel";
import type { NavItem } from "./nav";
import type { Section } from "./section";

export interface ParsedCommand {
    /** Units after a leading `craft`/`c` verb; `null` without one. */
    craft: number | null;
    /** What's left to search for (keeps the Browser's `@mod`, `-word`, `>100` syntax). */
    query: string;
}

const MAX_CRAFT = 2_000_000_000;

/** `64`, `x64`, `1k`, `2.5k`, `1m` -> units; `null` for anything else. */
export function parseQuantity(token: string): number | null {
    const m = /^x?(\d+(?:\.\d+)?)([km])?$/i.exec(token);
    if (!m) return null;
    const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
    const n = Math.round(Number(m[1]) * scale);
    return n >= 1 && n <= MAX_CRAFT ? n : null;
}

/** `craft 64 logic` / `c 1k steel` / `craft logic` (a stack) / anything else as a plain search. */
export function parseCommand(raw: string): ParsedCommand {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || !/^(craft|c)$/i.test(tokens[0]!)) return { craft: null, query: raw.trim() };
    const qty = tokens[1] !== undefined ? parseQuantity(tokens[1]) : null;
    const rest = tokens.slice(qty !== null ? 2 : 1).join(" ");
    return { craft: qty ?? 64, query: rest };
}

export type CommandAction =
    | { type: "craft"; item: BrowserItem; quantity: number; cpuKey?: string }
    | { type: "item"; item: BrowserItem }
    | { type: "cpu"; cpu: CpuView }
    | { type: "section"; section: Section }
    | { type: "refresh" }
    | { type: "settings" };

export interface CommandRow {
    id: string;
    label: string;
    meta: string;
    /** Right-hand key hint. */
    hint: string;
    /** What the row shows as its tile: an item, a CPU, or nothing. */
    tile: { kind: "item"; itemid: string; itemname: string } | { kind: "cpu"; name: string; color: string } | null;
    action: CommandAction;
    /** The ⇧⏎ alternative, when the row has one. */
    shiftAction?: CommandAction;
}

export interface CommandGroup {
    label: string;
    rows: CommandRow[];
}

export interface CommandSources {
    items: BrowserItem[];
    cpus: CpuView[];
    nav: NavItem[];
    numberFormat: "full" | "compact";
}

/** Two-key go-to shortcuts (`g` then this letter), shown beside the sections. */
export const GO_KEYS: Record<Section, string> = {
    browser: "i",
    jobs: "c",
    history: "h",
    favorites: "f",
    stats: "s",
    bottlenecks: "b",
    machines: "m",
    power: "p",
    production: "o",
};

const MAX_ITEMS = 6;
const MAX_CPUS = 4;

function itemTile(item: BrowserItem): CommandRow["tile"] {
    return { kind: "item", itemid: item.itemid, itemname: item.itemname };
}

/** Idle CPUs on `gridKey`, most free storage first - the ⇧⏎ craft target. */
function roomiestIdleCpu(cpus: CpuView[], gridKey: string): CpuView | null {
    const idle = cpus.filter((c) => c.sourceGridKey === gridKey && !c.isBusy);
    idle.sort((a, b) => b.availableStorage - a.availableStorage);
    return idle[0] ?? null;
}

function matchItems(items: BrowserItem[], query: string, craftableOnly: boolean): BrowserItem[] {
    if (query.trim() === "") return [];
    const rows = filterItems(items, { storedCraftable: craftableOnly ? 1 : 2, itemsType: 2, search: query });
    const needle = query.trim().toLowerCase();
    // Names that start with the query first, then by stored amount.
    const rank = (it: BrowserItem) => (it.plainName.toLowerCase().startsWith(needle) ? 0 : 1);
    return rows.sort((a, b) => rank(a) - rank(b) || b.quantity - a.quantity).slice(0, MAX_ITEMS);
}

export function buildCommandGroups(raw: string, src: CommandSources): CommandGroup[] {
    const { craft, query } = parseCommand(raw);
    const needle = query.trim().toLowerCase();
    const groups: CommandGroup[] = [];

    const actions: CommandRow[] = [];
    if (craft !== null) {
        for (const item of matchItems(src.items, query, true)
            .filter((it) => it.itemKey !== null)
            .slice(0, 2)) {
            const target = roomiestIdleCpu(src.cpus, item.sourceGridKey);
            const name = skipSpecialFormat(item.itemname);
            actions.push({
                id: `craft:${item.sourceGridKey}:${item.itemid}`,
                label: `Craft ${formatNumber(craft)} × ${name}`,
                meta: target ? `⇧⏎ on ${target.name} (${formatBytes(target.availableStorage)} free)` : "auto CPU",
                hint: "⏎",
                tile: itemTile(item),
                action: { type: "craft", item, quantity: craft },
                shiftAction: target ? { type: "craft", item, quantity: craft, cpuKey: target.cpuKey } : undefined,
            });
        }
    }
    if ("refresh".startsWith(needle) && needle !== "") {
        actions.push({
            id: "refresh",
            label: "Refresh",
            meta: "reload everything",
            hint: "",
            tile: null,
            action: { type: "refresh" },
        });
    }
    if ("settings".startsWith(needle) && needle !== "") {
        actions.push({
            id: "settings",
            label: "Settings",
            meta: "",
            hint: "",
            tile: null,
            action: { type: "settings" },
        });
    }
    if (actions.length > 0) groups.push({ label: "Actions", rows: actions });

    const items = matchItems(src.items, query, false).map((item): CommandRow => ({
        id: `item:${item.sourceGridKey}:${item.itemid}`,
        label: skipSpecialFormat(item.itemname),
        meta: `${formatNumber(item.quantity, src.numberFormat)} stored`,
        hint: "",
        tile: itemTile(item),
        action: { type: "item", item },
        shiftAction:
            item.craftable && item.itemKey !== null ? { type: "craft", item, quantity: craft ?? 64 } : undefined,
    }));
    if (items.length > 0) groups.push({ label: "Items", rows: items });

    const cpus = src.cpus
        .filter((c) => c.isBusy)
        .filter(
            (c) =>
                needle === "" ||
                c.name.toLowerCase().includes(needle) ||
                (c.finalOutput !== null && skipSpecialFormat(c.finalOutput.itemname).toLowerCase().includes(needle)),
        )
        .sort((a, b) => cpuRank(a) - cpuRank(b))
        .slice(0, MAX_CPUS)
        .map((cpu): CommandRow => ({
            id: `cpu:${cpu.sourceGridKey}:${cpu.cpuKey}`,
            label: cpu.finalOutput
                ? `${cpu.name} · ${skipSpecialFormat(cpu.finalOutput.itemname)} ×${formatNumber(cpu.finalOutput.quantity)}`
                : cpu.name,
            meta: cpu.stalledSince > 0 ? "stalled" : cpu.progressPct !== null ? `${cpu.progressPct}%` : "crafting",
            hint: "",
            tile: { kind: "cpu", name: cpu.name, color: cpu.stalledSince > 0 ? "var(--red)" : "var(--amber)" },
            action: { type: "cpu", cpu },
        }));
    if (craft === null && cpus.length > 0) groups.push({ label: "CPUs", rows: cpus });

    const sections = src.nav
        .filter((n) => craft === null && (needle === "" || n.label.toLowerCase().includes(needle)))
        .map((n): CommandRow => ({
            id: `go:${n.section}`,
            label: n.label,
            meta: "",
            hint: `G ${GO_KEYS[n.section].toUpperCase()}`,
            tile: null,
            action: { type: "section", section: n.section },
        }));
    if (sections.length > 0) groups.push({ label: "Go to", rows: sections });

    return groups;
}
