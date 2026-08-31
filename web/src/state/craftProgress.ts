// Shared crafting-progress arithmetic, so the Jobs card bar (cpus.tsx) and the Craft Detail page
// (views/craftDetailModel.ts) can never disagree on what "how far along is this job" means. No real
// `requested` field exists (REDESIGN_MILESTONES.md caveat 1) - it's approximated per item as
// `craftedTotal + active + pending`.
import type { CompactedItem } from "../api/types";

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
            crafted += item.craftedTotal;
            requested += item.craftedTotal + item.active + item.pending;
            totalTime += item.timeSpentCrafting;
        }
    }
    return { crafted, requested, totalTime };
}

/** `0..1`, or `0` when there's nothing to derive a fraction from. Callers clamp/scale as needed. */
export function progressFraction(t: CraftTotals): number {
    if (t.requested <= 0) return 0;
    return Math.min(1, t.crafted / t.requested);
}
