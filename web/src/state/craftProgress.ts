// Shared crafting-progress arithmetic for the Craft Detail page (views/craftDetailModel.ts). A tracked
// job carries each item's `planned` units, fixed when it started; an item without one (a byproduct, a
// pre-snapshot job) falls back to `craftedTotal + active + pending`. Fluids count one per bucket, not per L.
import { formatLiters, formatNumber } from "../api/format";
import type { CompactedItem } from "../api/types";
import { isFluidId } from "../views/browserModel";

/**
 * A resource's weight in a job's progress: items one each, fluids (amounts in L) one per bucket, so a fluid step
 * doesn't outweigh every item of the job a thousandfold. Mirrors `AE2JobTracker.progressUnits` on the server.
 */
export function progressUnits(itemid: string, amount: number): number {
    return isFluidId(itemid) ? amount / 1000 : amount;
}

/** A per-resource amount: an item count, or a fluid in L/kL/ML. */
export function formatResourceAmount(itemid: string, amount: number): string {
    return isFluidId(itemid) ? formatLiters(amount) : formatNumber(amount);
}

export interface CraftTotals {
    crafted: number;
    requested: number;
    /** Sum of every item's `timeSpentCrafting`, ms. Only meaningful when tracking was on. */
    totalTime: number;
}

export function craftTotals(items: CompactedItem[] | null): CraftTotals {
    let crafted = 0;
    let requested = 0;
    let totalTime = 0;
    if (items) {
        for (const item of items) {
            crafted += progressUnits(item.itemid, item.craftedTotal);
            requested += progressUnits(
                item.itemid,
                item.planned > 0 ? item.planned : item.craftedTotal + item.active + item.pending,
            );
            totalTime += item.timeSpentCrafting;
        }
    }
    return { crafted, requested, totalTime };
}

/**
 * Remaining time by linear extrapolation, or `null` while too early to say: the first stretch of a job is
 * dominated by setup, so it waits for 15% progress and 20 s of history.
 */
export function estimateRemaining(elapsedMs: number, fraction: number): number | null {
    if (fraction < 0.15 || fraction >= 1 || elapsedMs <= 20_000) return null;
    return (elapsedMs * (1 - fraction)) / fraction;
}
