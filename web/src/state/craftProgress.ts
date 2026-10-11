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

/** One reading of a job's progress: server-measured elapsed ms and crafted units (`craftTotals`) at that moment. */
export interface ProgressSample {
    elapsed: number;
    crafted: number;
}

/** How far back the recent rate looks, and the least history it needs to say anything. */
export const RECENT_WINDOW_MS = 5 * 60_000;
const RECENT_MIN_SPAN_MS = 60_000;

/**
 * Units crafted per second over the last `RECENT_WINDOW_MS` of `samples` (oldest first), or `null` with
 * under a minute of history or no progress in it. Unlike the whole-job average this follows a job that
 * front-loads its quick steps and slows down on the long ones.
 */
export function recentRate(samples: ProgressSample[]): number | null {
    const last = samples[samples.length - 1];
    if (!last) return null;
    const first = samples.find((s) => s.elapsed >= last.elapsed - RECENT_WINDOW_MS)!;
    const span = last.elapsed - first.elapsed;
    if (span < RECENT_MIN_SPAN_MS || last.crafted <= first.crafted) return null;
    return ((last.crafted - first.crafted) / span) * 1000;
}

/** Remaining time at the recent rate, or `null` when `recentRate` has no answer. */
export function recentRemaining(samples: ProgressSample[], requested: number): number | null {
    const rate = recentRate(samples);
    const last = samples[samples.length - 1];
    if (rate === null || !last) return null;
    return (Math.max(0, requested - last.crafted) / rate) * 1000;
}

/** Units crafted in each whole minute of elapsed time that `samples` cover, oldest first. */
export function craftedPerMinute(samples: ProgressSample[]): number[] {
    if (samples.length < 2) return [];
    const start = Math.floor(samples[0]!.elapsed / 60_000);
    const buckets: number[] = [];
    for (let i = 1; i < samples.length; i++) {
        const minute = Math.floor(samples[i]!.elapsed / 60_000) - start;
        while (buckets.length <= minute) buckets.push(0);
        buckets[minute]! += Math.max(0, samples[i]!.crafted - samples[i - 1]!.crafted);
    }
    return buckets;
}
