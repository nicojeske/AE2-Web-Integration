import type { BrowserItem } from "../state/items";
import { DEFAULT_THRESHOLDS, prefsKey, type Thresholds } from "../state/prefs";

/** Labels for the "Stored/Craftable" toolbar pill; index is the cycled state (default 2). */
export const STORED_CRAFTABLE = ["Stored only", "Craftable only", "Stored & craftable"] as const;
/** Labels for the "Items/Fluids" toolbar pill; index is the cycled state (default 2). */
export const ITEMS_TYPE = ["Items only", "Fluids only", "Items & fluids"] as const;
/** Labels for the "Sort by" toolbar pill; index is the cycled state (default 0). */
export const SORT_BY = ["A-Z", "# stored", "Mod"] as const;

/**
 * The mod namespace an item belongs to, from the part of `itemid` before the first `:`. A native
 * fluid's itemid has no colon at all (see `isFluidId`) - group those under a synthetic "fluid" mod
 * rather than the legacy UI's `substring(0, -1)` empty string.
 */
export function modOf(itemid: string): string {
    const i = itemid.indexOf(":");
    return i === -1 ? "fluid" : itemid.slice(0, i);
}

/**
 * No server field distinguishes fluids from items (see REDESIGN_MILESTONES.md's fluids caveat -
 * `web$isFluid()` was deliberately removed from `IAEKey`, and 1.20.1/1.21.1 give fluids the same
 * `namespace:path` shape as items). Heuristic: a colon-free id is a native fluid on 1.7.10/1.12.2;
 * an `ae2fc:fluid_drop*` id is AE2FluidCraft's fluid-drop item (the legacy UI's exact test was
 * `itemid == 'ae2fc:fluid_drop:0'`). Indistinguishable on 1.20.1/1.21.1 - the browser hides the
 * Items/Fluids pill entirely when nothing in the current list matches this.
 */
export function isFluidId(itemid: string): boolean {
    return !itemid.includes(":") || itemid.startsWith("ae2fc:fluid_drop");
}

export interface ItemFilters {
    storedCraftable: 0 | 1 | 2;
    itemsType: 0 | 1 | 2;
    search: string;
}

/**
 * A parsed search query (M12) - `filterItems` never re-tokenizes the raw string itself, so every caller
 * (the live Browser filter, a future saved-search feature) sees the exact same rules.
 */
export interface SearchQuery {
    /** Plain (non-prefixed) words, re-joined with single spaces - matches the pre-M12 behaviour exactly
     *  when the query has no special tokens at all, so a plain search never changes meaning. */
    text: string;
    /** `@mod` tokens - every one must be a substring of the item's mod namespace. */
    mods: string[];
    /** `-word` tokens - an item is dropped if ANY of these is a substring of its name or itemid. */
    excludes: string[];
    /** `>100` tokens - the item's quantity must exceed every one given (multiple only makes sense as the
     *  strictest one winning, which "every token must pass" already gives for free). */
    minQuantities: number[];
}

/**
 * Tokenizes on whitespace and classifies each token by its prefix - `@mod`, `-exclude`, `>qty` - leaving
 * everything else as plain search text. Malformed special tokens (e.g. `>abc`, a bare `@`/`-`/`>`) fall
 * back to plain text rather than being silently dropped, so a stray `@`/`-`/`>` in an item name search
 * still does something sensible.
 */
export function parseSearchQuery(raw: string): SearchQuery {
    const mods: string[] = [];
    const excludes: string[] = [];
    const minQuantities: number[] = [];
    const plainWords: string[] = [];

    for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
        if (token.startsWith("@") && token.length > 1) {
            mods.push(token.slice(1).toLowerCase());
        } else if (token.startsWith("-") && token.length > 1) {
            excludes.push(token.slice(1).toLowerCase());
        } else if (token.startsWith(">") && token.length > 1 && Number.isFinite(Number(token.slice(1)))) {
            minQuantities.push(Number(token.slice(1)));
        } else {
            plainWords.push(token);
        }
    }

    return { text: plainWords.join(" ").toLowerCase(), mods, excludes, minQuantities };
}

/** `0` = quantity > 0 ("Stored only"), `1` = craftable ("Craftable only"), `2` = no filter. */
export function filterItems(rows: BrowserItem[], filters: ItemFilters): BrowserItem[] {
    const query = parseSearchQuery(filters.search);
    return rows.filter((it) => {
        if (filters.storedCraftable === 0 && !(it.quantity > 0)) return false;
        if (filters.storedCraftable === 1 && !it.craftable) return false;
        if (filters.itemsType !== 2 && it.isFluid !== (filters.itemsType === 1)) return false;

        const plainName = it.plainName.toLowerCase();
        const itemid = it.itemid.toLowerCase();
        if (query.text && !plainName.includes(query.text) && !itemid.includes(query.text)) return false;
        if (query.mods.length > 0 && !query.mods.every((m) => it.mod.toLowerCase().includes(m))) return false;
        if (query.excludes.some((x) => plainName.includes(x) || itemid.includes(x))) return false;
        if (query.minQuantities.length > 0 && !query.minQuantities.every((min) => it.quantity > min)) return false;

        return true;
    });
}

/**
 * Sorts by the active pill, then pins favourites to the top - matching the prototype's two
 * successive sorts (`Array.prototype.sort` is stable, so folding a favourite rank into one
 * comparator produces the identical order without an extra pass).
 */
export function sortItems(
    rows: BrowserItem[],
    sortBy: 0 | 1 | 2,
    sortOrder: 0 | 1,
    isFavorite: (key: string) => boolean,
): BrowserItem[] {
    const dir = sortOrder === 1 ? -1 : 1;
    const primary = (a: BrowserItem, b: BrowserItem): number => {
        // `plainName` is already `skipSpecialFormat(itemname)` - matches the legacy comparator's
        // A-Z sort on the §-stripped name.
        if (sortBy === 0) return a.plainName.localeCompare(b.plainName);
        if (sortBy === 1) return a.quantity - b.quantity;
        return a.mod.localeCompare(b.mod);
    };
    const favRank = (it: BrowserItem): number => (isFavorite(prefsKey(it.sourceGridId, it.itemid)) ? 1 : 0);
    return rows.slice().sort((a, b) => favRank(b) - favRank(a) || primary(a, b) * dir);
}

/** The `alertBelow` in effect for a prefs key, falling back to the favoriting default. */
export function alertBelowFor(thresholds: Record<string, Thresholds>, key: string): number {
    return thresholds[key]?.alertBelow ?? DEFAULT_THRESHOLDS.alertBelow;
}

/**
 * Low stock is only ever shown for favourited items (the badge/pill is a favourites feature - an
 * un-favourited item has no `alertBelow` to compare against). Shared by the Browser badge, the sidebar
 * pill (`App.tsx`) and the Favorites pane (M6) so the three can never disagree.
 */
export function isLowStock(
    item: Pick<BrowserItem, "sourceGridId" | "itemid" | "quantity">,
    favorites: Record<string, true>,
    thresholds: Record<string, Thresholds>,
): boolean {
    const key = prefsKey(item.sourceGridId, item.itemid);
    if (!favorites[key]) return false;
    return item.quantity < alertBelowFor(thresholds, key);
}

/**
 * Any favourite with `autoCraft` on, resolvable in the currently loaded `items` - shared by
 * `state/items.tsx` (whether its own poll is worth arming regardless of the Settings auto-refresh
 * toggle) and `state/autoCraft.tsx` (whether there's anything for its own cycle to act on).
 */
export function hasAutoCraftFavorite(
    items: BrowserItem[],
    favorites: Record<string, true>,
    thresholds: Record<string, Thresholds>,
): boolean {
    return items.some((item) => {
        const key = prefsKey(item.sourceGridId, item.itemid);
        return favorites[key] && thresholds[key]?.autoCraft;
    });
}
