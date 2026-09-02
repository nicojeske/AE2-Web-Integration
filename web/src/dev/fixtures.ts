// Dev-only fixture data for mock-server.ts. Shapes mirror the real Java DTOs (see src/api/types.ts) -
// keep them in sync as later milestones need richer scenarios.
import type {
    CompactedItem,
    CpuList,
    DetailedItem,
    DimensionalCoords,
    GridSummary,
    ItemHistoryResult,
    ItemStack,
    JobData,
    JobPlanItem,
    StatsRange,
    TrackingDetail,
    TrackingHistoryElement,
} from "../api/types.ts";
import { HISTORY_NO_SAMPLE } from "../api/types.ts";

export interface MockRecipeRow {
    itemid: string;
    itemname: string;
    requested: number;
    stored: number;
}

export interface MockBusyCpu {
    name: string;
    coProcessors: number;
    availableStorage: number;
    usedStorage: number;
    output: ItemStack;
    startedAt: number;
    /** Wall-clock ms for the mock craft to reach 100%. */
    craftDurationMs: number;
    hasTrackingInfo: boolean;
    recipe: MockRecipeRow[];
}

export interface MockGrid {
    key: number;
    owner: string;
    isOwned: boolean;
    isTrackingEnabled: boolean;
    items: DetailedItem[];
    idleCpus: { name: string; coProcessors: number; availableStorage: number }[];
    busyCpus: MockBusyCpu[];
    history: TrackingHistoryElement[];
    trackingDetails: Map<number, TrackingDetail>;
    /** M8: this grid's server-side tracked-item set (order matters - the server preserves insertion order). */
    trackedItems: string[];
    /** M8: when each tracked item's history begins - untrack/re-track resets it, mirroring `pruneTo`. */
    historyStart: Map<string, number>;
}

const serverStart = Date.now();

// M8 Statistics fixture tuning - deliberately small so the cap is reachable by clicking in dev.
export const MOCK_TRACKED_LIMIT = 8;
export const MOCK_SAMPLE_INTERVAL_MS = 5 * 60_000;
export const MOCK_FINE_RETENTION_MS = 30 * 86_400_000;
export const MOCK_HOURLY_RETENTION_DAYS = 365;
const MOCK_HOURLY_BUCKET_MS = 60 * 60_000;

export const mockGrids: MockGrid[] = [
    {
        key: 1,
        owner: "Steve",
        isOwned: true,
        isTrackingEnabled: true,
        items: [
            {
                hashcode: 1001,
                itemid: "minecraft:iron_ingot",
                itemname: "Iron Ingot",
                quantity: 12480,
                craftable: true,
            },
            { hashcode: 1002, itemid: "minecraft:redstone", itemname: "Redstone", quantity: 3400, craftable: true },
            {
                hashcode: 1003,
                itemid: "appliedenergistics2:crystal_fluix",
                itemname: "Fluix Crystal",
                quantity: 860,
                craftable: true,
            },
            {
                hashcode: 1004,
                itemid: "appliedenergistics2:crystal_certus",
                itemname: "Certus Quartz Crystal",
                quantity: 210,
                craftable: false,
            },
            {
                hashcode: 1005,
                itemid: "appliedenergistics2:material_silicon",
                itemname: "Silicon",
                quantity: 640,
                craftable: true,
            },
            {
                hashcode: 1006,
                itemid: "appliedenergistics2:processor_calc",
                itemname: "§b§lProcessor (Calculation)",
                quantity: 24,
                craftable: true,
            },
            {
                hashcode: 1007,
                itemid: "appliedenergistics2:sky_stone_block",
                itemname: "Sky Stone Block",
                quantity: 1800,
                craftable: true,
            },
            { hashcode: 1008, itemid: "ae2fc:fluid_drop:water", itemname: "Water", quantity: 64000, craftable: false },
            // Extra mods, plus the shapes M1 needs real fixture coverage for:
            {
                hashcode: 1009,
                itemid: "thermalfoundation:material",
                itemname: "Tin Ingot",
                quantity: 320,
                craftable: true,
            },
            // Craft-only, unstored - GetItems.java synthesises these via web$stackOf(craftable, 0).
            {
                hashcode: 1010,
                itemid: "thermalfoundation:material_copper",
                itemname: "Copper Ingot",
                quantity: 0,
                craftable: true,
            },
            {
                hashcode: 1011,
                itemid: "immersiveengineering:metal_aluminum",
                itemname: "Aluminum",
                quantity: 0,
                craftable: true,
            },
            {
                hashcode: 1012,
                itemid: "immersiveengineering:metal_steel",
                itemname: "Steel Ingot",
                quantity: 512,
                craftable: true,
            },
            // Under the default alertBelow (100) - star these in dev to see "Low stock".
            {
                hashcode: 1013,
                itemid: "biomesoplenty:gem_amethyst",
                itemname: "Amethyst",
                quantity: 88,
                craftable: false,
            },
            {
                hashcode: 1014,
                itemid: "biomesoplenty:log_mahogany",
                itemname: "Mahogany Log",
                quantity: 2200,
                craftable: false,
            },
            {
                hashcode: 1015,
                itemid: "mekanism:ingot_osmium",
                itemname: "Osmium Ingot",
                quantity: 960,
                craftable: true,
            },
            { hashcode: 1016, itemid: "mekanism:dust_iron", itemname: "Dust (Iron)", quantity: 3050, craftable: true },
            {
                hashcode: 1017,
                itemid: "appliedenergistics2:quartz",
                itemname: "Certus Quartz",
                quantity: 1500,
                craftable: true,
            },
            // A native fluid's itemid has no colon at all on 1.7.10/1.12.2 (fluid.getName()) - unlike
            // the ae2fc fluid-drop item above, which is a real item id. Both should trip isFluidId.
            { hashcode: 1018, itemid: "molten.fluix", itemname: "Molten Fluix", quantity: 4000, craftable: false },
            // Under the default alertBelow (100) *and* craftable - star this one with Auto-craft on in
            // dev to exercise the M6 driver end to end (order -> plan -> submit -> stock credited on
            // completion via settleCompletedJobs, above).
            {
                hashcode: 1019,
                itemid: "minecraft:charcoal",
                itemname: "Charcoal",
                quantity: 40,
                craftable: true,
            },
            // M8 chart-quality/derived-metrics pass: a monotonically declining tracked item, so
            // `seriesStats`' negative `slopePerHour` and `timeToEmptyMillis`'s projection have
            // something to show in dev - see mockBucketValue's "sand" branch.
            { hashcode: 1020, itemid: "minecraft:sand", itemname: "Sand", quantity: 1500, craftable: false },
            // Large-magnitude tracked item (~2.4M) alongside everything else's 3-4 digit quantities -
            // exercises log scale and compact number formatting on the overview's aggregate chart.
            {
                hashcode: 1021,
                itemid: "appliedenergistics2:matter_ball",
                itemname: "Matter Ball",
                quantity: 2_400_000,
                craftable: true,
            },
        ],
        idleCpus: [{ name: "Assembly Cluster B", coProcessors: 2, availableStorage: 2 * 1024 * 1024 }],
        busyCpus: [
            {
                name: "Assembly Cluster A",
                coProcessors: 6,
                availableStorage: 8 * 1024 * 1024,
                usedStorage: Math.round(2.1 * 1024 * 1024),
                output: {
                    itemid: "appliedenergistics2:processor_calc",
                    itemname: "§b§lProcessor (Calculation)",
                    hashcode: 1006,
                    quantity: 16,
                },
                startedAt: serverStart - 214_000,
                craftDurationMs: 6 * 60_000,
                hasTrackingInfo: true,
                recipe: [
                    {
                        itemid: "appliedenergistics2:processor_calc",
                        itemname: "Processor (Calculation)",
                        requested: 16,
                        stored: 24,
                    },
                    {
                        itemid: "appliedenergistics2:crystal_fluix",
                        itemname: "Fluix Crystal",
                        requested: 48,
                        stored: 860,
                    },
                    {
                        itemid: "appliedenergistics2:crystal_certus",
                        itemname: "Certus Quartz Crystal",
                        requested: 64,
                        stored: 210,
                    },
                    { itemid: "appliedenergistics2:material_silicon", itemname: "Silicon", requested: 24, stored: 640 },
                    { itemid: "minecraft:redstone", itemname: "Redstone", requested: 40, stored: 3400 },
                    // Two extra rows (beyond the 5 needed for the busy-CPU list) so "Top 5 by time
                    // spent" actually truncates rather than showing every row.
                    {
                        itemid: "appliedenergistics2:material_certus_quartz_dust",
                        itemname: "Pure Certus Quartz Crystal",
                        requested: 32,
                        stored: 96,
                    },
                    {
                        itemid: "appliedenergistics2:material_calc_processor_press",
                        itemname: "Calculation Processor Press",
                        requested: 8,
                        stored: 4,
                    },
                ],
            },
            {
                // Busy + untracked (grid tracking was off when this job started): exercises the M2
                // "no progress bar for an untracked busy CPU" degradation, and `usedStorage === -1`,
                // which real modern-AE2 mixins hardcode (see REDESIGN_MILESTONES.md notes for M2).
                name: "Fluix Cluster",
                coProcessors: 2,
                availableStorage: 2 * 1024 * 1024,
                usedStorage: -1,
                output: {
                    itemid: "appliedenergistics2:crystal_fluix",
                    itemname: "Fluix Crystal",
                    hashcode: 1003,
                    quantity: 256,
                },
                startedAt: serverStart - 40_000,
                craftDurationMs: 5 * 60_000,
                hasTrackingInfo: false,
                recipe: [
                    {
                        itemid: "appliedenergistics2:crystal_fluix",
                        itemname: "Fluix Crystal",
                        requested: 256,
                        stored: 860,
                    },
                ],
            },
        ],
        history: [
            {
                id: 1,
                timeStarted: serverStart - 3_600_000,
                timeDone: serverStart - 3_348_000,
                wasCancelled: false,
                finalOutput: {
                    itemid: "appliedenergistics2:crystal_fluix",
                    itemname: "Fluix Crystal",
                    hashcode: 1003,
                    quantity: 128,
                },
            },
            {
                id: 2,
                timeStarted: serverStart - 7_200_000,
                timeDone: serverStart - 7_159_000,
                wasCancelled: true,
                finalOutput: {
                    itemid: "appliedenergistics2:sky_stone_block",
                    itemname: "Sky Stone Block",
                    hashcode: 1007,
                    quantity: 512,
                },
            },
            {
                id: 3,
                timeStarted: serverStart - 1_800_000,
                timeDone: serverStart - 1_200_000,
                wasCancelled: false,
                finalOutput: {
                    itemid: "appliedenergistics2:processor_calc",
                    itemname: "Calculation Processor",
                    hashcode: 1010,
                    quantity: 256,
                },
            },
            // No matching `trackingDetails` entry - a job whose tracking record is gone (e.g. server
            // restart between when it finished and now, since history is `@GSONUtils.SkipGSON` and never
            // persisted) still shows up in `trackinghistory`; opening it must hit `TRACKING_NOT_FOUND`.
            {
                id: 4,
                timeStarted: serverStart - 10_800_000,
                timeDone: serverStart - 10_740_000,
                wasCancelled: false,
                finalOutput: {
                    itemid: "minecraft:redstone",
                    itemname: "Redstone",
                    hashcode: 1099,
                    quantity: 64,
                },
            },
        ],
        trackingDetails: new Map([
            [
                1,
                {
                    finalOutput: {
                        itemid: "appliedenergistics2:crystal_fluix",
                        itemname: "Fluix Crystal",
                        hashcode: 1003,
                        quantity: 128,
                    },
                    timeStarted: serverStart - 3_600_000,
                    timeDone: serverStart - 3_348_000,
                    wasCancelled: false,
                    items: [
                        {
                            itemid: "appliedenergistics2:crystal_fluix",
                            itemname: "Fluix Crystal",
                            timeSpentOn: 180_000,
                            craftedTotal: 128,
                            shareInCraftingTime: 0.7,
                            shareInCraftingTimeCombined: 0.7,
                            craftsPerSec: 128 / 180,
                            timings: [{ started: serverStart - 3_600_000, ended: serverStart - 3_420_000 }],
                        },
                        {
                            itemid: "appliedenergistics2:crystal_certus",
                            itemname: "Certus Quartz Crystal",
                            timeSpentOn: 72_000,
                            craftedTotal: 128,
                            shareInCraftingTime: 0.3,
                            shareInCraftingTimeCombined: 0.3,
                            craftsPerSec: 128 / 72,
                            timings: [{ started: serverStart - 3_420_000, ended: serverStart - 3_348_000 }],
                        },
                    ],
                    interfaceShare: [
                        {
                            name: "ME Interface (Fluix Crystal)",
                            timings: [{ started: serverStart - 3_600_000, ended: serverStart - 3_348_000 }],
                            timingsCombined: 252_000,
                            location: [{ dimid: "0", x: 120, y: 70, z: -340 } satisfies DimensionalCoords],
                        },
                    ],
                } satisfies TrackingDetail,
            ],
            [
                // Richer than the mechanically-generated entries above/below: several items, one of them
                // with two disjoint (co-processor-style) timing windows, and three interfaces including a
                // nameless one (`AE2JobTracker`'s literal `"[NULL]"`) with several locations each, plus a
                // cross-dimension coord - exercises the timeline's multi-segment rows and multi-location
                // tooltips under `npm run dev` without needing a real multi-processor AE2 network.
                3,
                {
                    finalOutput: {
                        itemid: "appliedenergistics2:processor_calc",
                        itemname: "Calculation Processor",
                        hashcode: 1010,
                        quantity: 256,
                    },
                    timeStarted: serverStart - 1_800_000,
                    timeDone: serverStart - 1_200_000,
                    wasCancelled: false,
                    items: [
                        {
                            itemid: "appliedenergistics2:crystal_fluix",
                            itemname: "Fluix Crystal",
                            timeSpentOn: 260_000,
                            craftedTotal: 768,
                            shareInCraftingTime: 0.45,
                            shareInCraftingTimeCombined: 0.43,
                            craftsPerSec: 768 / 260,
                            timings: [
                                { started: serverStart - 1_800_000, ended: serverStart - 1_650_000 },
                                { started: serverStart - 1_500_000, ended: serverStart - 1_390_000 },
                            ],
                        },
                        {
                            itemid: "appliedenergistics2:crystal_certus",
                            itemname: "Certus Quartz Crystal",
                            timeSpentOn: 210_000,
                            craftedTotal: 1024,
                            shareInCraftingTime: 0.35,
                            shareInCraftingTimeCombined: 0.35,
                            craftsPerSec: 1024 / 210,
                            timings: [{ started: serverStart - 1_760_000, ended: serverStart - 1_550_000 }],
                        },
                        {
                            itemid: "appliedenergistics2:material_silicon",
                            itemname: "Silicon",
                            timeSpentOn: 120_000,
                            craftedTotal: 384,
                            shareInCraftingTime: 0.2,
                            shareInCraftingTimeCombined: 0.2,
                            craftsPerSec: 384 / 120,
                            timings: [{ started: serverStart - 1_390_000, ended: serverStart - 1_270_000 }],
                        },
                    ],
                    interfaceShare: [
                        {
                            name: "ME Interface (Fluix Crystal)",
                            timings: [
                                { started: serverStart - 1_800_000, ended: serverStart - 1_650_000 },
                                { started: serverStart - 1_500_000, ended: serverStart - 1_390_000 },
                            ],
                            timingsCombined: 260_000,
                            location: [
                                { dimid: "0", x: 120, y: 70, z: -340 } satisfies DimensionalCoords,
                                { dimid: "0", x: 121, y: 70, z: -340 } satisfies DimensionalCoords,
                            ],
                        },
                        {
                            name: "ME Interface (Certus Quartz Crystal)",
                            timings: [{ started: serverStart - 1_760_000, ended: serverStart - 1_550_000 }],
                            timingsCombined: 210_000,
                            location: [{ dimid: "0", x: 118, y: 70, z: -338 } satisfies DimensionalCoords],
                        },
                        {
                            // AE2JobTracker.java:190-192 - the literal name a null-named interface arrives
                            // as, and interfaces are deduplicated by name only, so this one row stands in
                            // for several physical (and here, cross-dimensional) machines.
                            name: "[NULL]",
                            timings: [{ started: serverStart - 1_390_000, ended: serverStart - 1_270_000 }],
                            timingsCombined: 120_000,
                            location: [
                                { dimid: "-1", x: 40, y: 60, z: 200 } satisfies DimensionalCoords,
                                { dimid: "-1", x: 41, y: 60, z: 200 } satisfies DimensionalCoords,
                                { dimid: "1", x: 5, y: 80, z: 5 } satisfies DimensionalCoords,
                            ],
                        },
                    ],
                } satisfies TrackingDetail,
            ],
        ]),
        // M8: seven tracked items (one below the 8-item mock cap, so an eighth click reaches
        // TRACKED_LIMIT_REACHED) covering a normal trend, a gap, a zero-baseline ramp, a
        // just-started item, a flat §-formatted one, a decline, and a large-magnitude item - see
        // mockItemHistory's scenario table.
        trackedItems: [
            "minecraft:iron_ingot",
            "minecraft:redstone",
            "appliedenergistics2:material_silicon",
            "appliedenergistics2:crystal_certus",
            "appliedenergistics2:processor_calc",
            "minecraft:sand",
            "appliedenergistics2:matter_ball",
        ],
        historyStart: new Map([
            ["minecraft:iron_ingot", serverStart - 40 * 86_400_000],
            ["minecraft:redstone", serverStart - 40 * 86_400_000],
            // Recent on purpose (see mockBucketValue's silicon branch) - its zero-then-ramp shape is
            // relative to this timestamp, not the full retention window, so it's visible within the
            // default 7d card/compare range rather than only at "All time".
            ["appliedenergistics2:material_silicon", serverStart - 6 * 86_400_000],
            // Tracking "just started" - only the last ~12 minutes have any real samples.
            ["appliedenergistics2:crystal_certus", serverStart - 12 * 60_000],
            ["appliedenergistics2:processor_calc", serverStart - 40 * 86_400_000],
            // Anchored 10 days back (not the full 365-day retention), like silicon's ramp, so the
            // decline is visible within the default 7d card/compare range.
            ["minecraft:sand", serverStart - 10 * 86_400_000],
            ["appliedenergistics2:matter_ball", serverStart - 40 * 86_400_000],
        ]),
    },
    {
        key: 2,
        owner: "Notch",
        isOwned: false,
        isTrackingEnabled: false,
        items: [
            {
                hashcode: 2001,
                itemid: "minecraft:cobblestone",
                itemname: "Cobblestone",
                quantity: 98400,
                craftable: false,
            },
            { hashcode: 2002, itemid: "minecraft:coal", itemname: "Coal", quantity: 5200, craftable: false },
            { hashcode: 2003, itemid: "minecraft:raw_iron", itemname: "Raw Iron", quantity: 2100, craftable: false },
            // Deliberately no fluids in this grid (unlike grid 1) - lets the Items/Fluids toolbar
            // pill be exercised appearing and disappearing when switching networks.
            { hashcode: 2004, itemid: "minecraft:granite", itemname: "Granite", quantity: 8000, craftable: false },
            // Grid 2's one craftable item - lets an M4 order/plan test target grid 2 in All-Grids mode
            // (every other row here is stored-only, unlike grid 1).
            { hashcode: 2005, itemid: "minecraft:brick", itemname: "Brick", quantity: 340, craftable: true },
        ],
        idleCpus: [{ name: "Outpost CPU", coProcessors: 1, availableStorage: 1024 * 1024 }],
        busyCpus: [
            {
                // Short craftDurationMs so completion (toast + notification + sidebar pill decrement,
                // and M3's Craft Detail freezing in place) fires well within a manual dev-testing
                // session, instead of requiring a long wait - also the only busy CPU on a second grid,
                // so the All-Grids fan-in touches both grids. 25s (not M2's original 8s) so it also
                // survives opening Craft Detail and watching it complete without a race against how
                // long it takes to click through to it after the dev server starts.
                name: "Foundry CPU",
                coProcessors: 3,
                availableStorage: 3 * 1024 * 1024,
                usedStorage: Math.round(0.5 * 1024 * 1024),
                output: {
                    itemid: "minecraft:coal",
                    itemname: "Coal",
                    hashcode: 2002,
                    quantity: 64,
                },
                startedAt: serverStart,
                craftDurationMs: 25_000,
                hasTrackingInfo: false,
                recipe: [{ itemid: "minecraft:coal", itemname: "Coal", requested: 64, stored: 5200 }],
            },
        ],
        history: [],
        trackingDetails: new Map(),
        trackedItems: ["minecraft:cobblestone"],
        historyStart: new Map([["minecraft:cobblestone", serverStart - 40 * 86_400_000]]),
    },
];

/** Admin-only, no security terminal attached - see GetGridList.java. */
export const unattachedGrid: GridSummary = {
    key: -1,
    owner: "N/A",
    cpuCount: 1,
    isOwned: false,
    isTrackingEnabled: false,
};

export function findGrid(key: number): MockGrid | undefined {
    return mockGrids.find((g) => g.key === key);
}

export function findItemByHashcode(hashcode: number): { grid: MockGrid; item: DetailedItem } | undefined {
    for (const grid of mockGrids) {
        const item = grid.items.find((i) => i.hashcode === hashcode);
        if (item) return { grid, item };
    }
    return undefined;
}

export function toGridSummaries(): GridSummary[] {
    return [
        ...mockGrids.map((g) => ({
            key: g.key,
            owner: g.owner,
            cpuCount: g.idleCpus.length + g.busyCpus.length,
            isOwned: g.isOwned,
            isTrackingEnabled: g.isTrackingEnabled,
        })),
        unattachedGrid,
    ];
}

function craftProgress(cpu: MockBusyCpu): number {
    return Math.min(1, (Date.now() - cpu.startedAt) / cpu.craftDurationMs);
}

/**
 * The mock has no server tick of its own, so a busy CPU never transitions to idle on its own - call
 * this before answering any request that reads CPU state, so a job whose `craftDurationMs` has
 * elapsed actually completes (lets M2's polling/completion-detection be exercised in `npm run dev`).
 */
export function settleCompletedJobs(grid: MockGrid): void {
    for (let i = grid.busyCpus.length - 1; i >= 0; i--) {
        const cpu = grid.busyCpus[i]!;
        if (craftProgress(cpu) >= 1) {
            recordTracking(grid, cpu, false);
            grid.busyCpus.splice(i, 1);
            grid.idleCpus.push({
                name: cpu.name,
                coProcessors: cpu.coProcessors,
                availableStorage: cpu.availableStorage,
            });
            // Credit the crafted output back into stock - without this, a favourite that dropped below
            // its keepStock would never rise again under npm run dev, and M6's auto-craft driver would
            // just keep re-firing on it forever.
            const outputItem = grid.items.find((i) => i.itemid === cpu.output.itemid);
            if (outputItem) outputItem.quantity += cpu.output.quantity;
        }
    }
}

/**
 * Pushes a `trackinghistory` entry (and matching `gettracking` detail) for a job leaving a CPU, so
 * completion and cancellation are both exercisable live under `npm run dev` - mirrors M2's
 * `settleCompletedJobs`, which made completion itself observable. Only tracked jobs are recorded
 * (`AE2JobTracker` never records at all when a grid's tracking was off when the job started). Simpler
 * than the hand-authored fixtures above/below: one timing segment per item, one synthetic interface -
 * good enough to prove the live wiring works, not meant to replace the richer static scenarios.
 */
export function recordTracking(grid: MockGrid, cpu: MockBusyCpu, wasCancelled: boolean): void {
    if (!cpu.hasTrackingInfo) return;
    const timeDone = Date.now();
    const elapsed = Math.max(1, timeDone - cpu.startedAt);
    const totalWeight = cpu.recipe.reduce((a, r) => a + r.requested, 0) || 1;

    let cursor = cpu.startedAt;
    const items: TrackingDetail["items"] = cpu.recipe.map((row) => {
        const started = cursor;
        const rowSpan = Math.round((row.requested / totalWeight) * elapsed);
        const ended = Math.min(timeDone, started + rowSpan);
        cursor = ended;
        const timeSpentOn = Math.max(0, ended - started);
        const craftedTotal = wasCancelled
            ? Math.round(row.requested * (timeSpentOn / Math.max(1, rowSpan)))
            : row.requested;
        return {
            itemid: row.itemid,
            itemname: row.itemname,
            timeSpentOn,
            craftedTotal,
            shareInCraftingTime: timeSpentOn / elapsed,
            shareInCraftingTimeCombined: Math.min(1, timeSpentOn / elapsed),
            craftsPerSec: timeSpentOn > 0 ? craftedTotal / (timeSpentOn / 1000) : 0,
            timings: [{ started, ended }],
        };
    });

    const id = grid.history.reduce((max, h) => Math.max(max, h.id), 0) + 1;
    grid.history.push({ id, timeStarted: cpu.startedAt, timeDone, wasCancelled, finalOutput: cpu.output });
    grid.trackingDetails.set(id, {
        finalOutput: cpu.output,
        timeStarted: cpu.startedAt,
        timeDone,
        wasCancelled,
        items,
        interfaceShare: [
            {
                name: `ME Interface (${cpu.output.itemname})`,
                timings: [{ started: cpu.startedAt, ended: timeDone }],
                timingsCombined: elapsed,
                location: [{ dimid: "0", x: 0, y: 64, z: 0 }],
            },
        ],
    });
}

export function toCpuList(grid: MockGrid): CpuList {
    const list: CpuList = {};
    for (const cpu of grid.idleCpus) {
        list[cpu.name] = {
            isBusy: false,
            finalOutput: null,
            availableStorage: cpu.availableStorage,
            usedStorage: 0,
            coProcessors: cpu.coProcessors,
            hasTrackingInfo: false,
            timeStarted: 0,
        };
    }
    for (const cpu of grid.busyCpus) {
        list[cpu.name] = {
            isBusy: true,
            finalOutput: cpu.output,
            availableStorage: cpu.availableStorage,
            usedStorage: cpu.usedStorage,
            coProcessors: cpu.coProcessors,
            hasTrackingInfo: cpu.hasTrackingInfo,
            // GetCPUList.java only sets timeStarted inside its hasTrackingInfo branch.
            timeStarted: cpu.hasTrackingInfo ? cpu.startedAt : 0,
        };
    }
    return list;
}

/**
 * Recipe rows craft strictly in sequence (weighted by `requested`, so bigger sub-crafts take
 * proportionally longer), each getting a `[windowStart, windowEnd]` slice of the overall craft
 * duration - unlike the old uniform-fraction version, which advanced every row in lockstep and so could
 * never produce a row sitting purely in Waiting (M3 needs Crafting/Waiting/Done to all be exercisable).
 */
export function toCompactedItems(cpu: MockBusyCpu): CompactedItem[] {
    const overallFraction = craftProgress(cpu);
    const totalWeight = cpu.recipe.reduce((a, r) => a + r.requested, 0) || 1;
    let cumulativeWeight = 0;
    return cpu.recipe.map((row) => {
        const windowStart = cumulativeWeight / totalWeight;
        cumulativeWeight += row.requested;
        const windowEnd = cumulativeWeight / totalWeight;
        const windowLength = Math.max(windowEnd - windowStart, 1e-6);
        const rowProgress = Math.min(1, Math.max(0, (overallFraction - windowStart) / windowLength));

        const craftedTotal = Math.round(row.requested * rowProgress);
        const remaining = row.requested - craftedTotal;
        // Only "active" mid-window - not yet started (rowProgress 0) sits in Waiting, finished
        // (rowProgress 1) sits in Done, matching the real `active>0`/`pending>0` column split.
        const active = rowProgress > 0 && rowProgress < 1 ? Math.min(4, remaining) : 0;
        const pending = Math.max(0, remaining - active);
        // Guards the division-by-zero -> NaN that the real GetCPU.java can hit when timeSpentCrafting is
        // still 0 (see REDESIGN_MILESTONES.md Notes) - the mock should not paper over that shape, only avoid
        // producing an actual NaN in dev JSON (JSON has no NaN literal).
        const timeSpentCrafting = cpu.hasTrackingInfo
            ? Math.round(cpu.craftDurationMs * windowLength * rowProgress)
            : 0;
        const craftsPerSec = timeSpentCrafting > 0 ? craftedTotal / (timeSpentCrafting / 1000) : 0;
        return {
            itemid: row.itemid,
            itemname: row.itemname,
            active,
            pending,
            stored: row.stored,
            timeSpentCrafting,
            craftedTotal,
            shareInCraftingTime: row.requested / 64,
            shareInCraftingTimeCombined: Math.min(1, timeSpentCrafting / cpu.craftDurationMs),
            craftsPerSec,
        };
    });
}

// M8 Statistics - deterministic history sampling. `mockItemHistory` reproduces
// `ItemHistoryStore.readSeries`'s bucket/downsample arithmetic exactly (see REDESIGN_MILESTONES.md's
// M7 notes) rather than approximating it, since the client's timestamp/count/gap handling depends on
// that arithmetic being right - an approximate mock would hide exactly the bugs worth catching.

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Deterministic pseudo-random in `[0,1)` from an itemid + fine-grained bucket index. */
function seededNoise(itemid: string, bucket: number): number {
    let h = (hashString(itemid) ^ Math.imul(bucket, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4_294_967_296;
}

function itemLiveQuantity(grid: MockGrid, itemid: string): number {
    return grid.items.find((i) => i.itemid === itemid)?.quantity ?? 0;
}

// Deliberate gap window for the redstone scenario: [now-9h, now-6h), independent of historyStart -
// exercises a broken line/area in the middle of a series that otherwise has plenty of real samples.
const REDSTONE_GAP_START_MS_AGO = 9 * 3_600_000;
const REDSTONE_GAP_END_MS_AGO = 6 * 3_600_000;

/** Value at one bucket, or `HISTORY_NO_SAMPLE` - see the scenario table in mockItemHistory's caller. */
function mockBucketValue(grid: MockGrid, itemid: string, bucketStartMs: number, now: number): number {
    const start = grid.historyStart.get(itemid);
    if (start === undefined || bucketStartMs < start) return HISTORY_NO_SAMPLE; // untracked, or predates tracking

    if (itemid === "minecraft:redstone") {
        const age = now - bucketStartMs;
        if (age <= REDSTONE_GAP_START_MS_AGO && age >= REDSTONE_GAP_END_MS_AGO) return HISTORY_NO_SAMPLE;
    }

    const live = itemLiveQuantity(grid, itemid);
    const fullSpanMs = MOCK_HOURLY_RETENTION_DAYS * 86_400_000;
    const t = Math.min(1, Math.max(0, (bucketStartMs - (now - fullSpanMs)) / fullSpanMs));
    const fineBucket = Math.floor(bucketStartMs / MOCK_SAMPLE_INTERVAL_MS);

    let target: number;
    let noiseAmplitude: number;
    if (itemid === "appliedenergistics2:processor_calc") {
        // Flat series (plus a §-formatted name) - exercises chartGeometry's span<=0 centering.
        target = live;
        noiseAmplitude = 0;
    } else if (itemid === "appliedenergistics2:material_silicon") {
        // Zero for the first 30% of *this item's own* tracked span, then ramps to the live value -
        // deliberately relative to `historyStart` (recent, see the fixture literal below) rather than
        // the full 365-day retention window, so the zero segment is actually visible within the
        // default 7d card/compare range instead of being masked by the historyStart gate above.
        // Exercises the compare modal's "peak" normalisation mode and the card's "n/a" delta pill.
        const localSpan = Math.max(1, now - start);
        const tLocal = Math.min(1, Math.max(0, (bucketStartMs - start) / localSpan));
        target = tLocal < 0.3 ? 0 : live * ((tLocal - 0.3) / 0.7);
        noiseAmplitude = target === 0 ? 0 : Math.max(1, live * 0.03);
    } else if (itemid === "minecraft:sand") {
        // Monotonic decline (modulo noise) over this item's own 10-day tracked span, from the live
        // quantity down to 20% of it - never quite reaching zero, so `timeToEmptyMillis` has a real
        // projection to make instead of reporting "already empty". Exercises the falling-rate path
        // and the overview's "at risk"/low-stock surfaces.
        const localSpan = Math.max(1, now - start);
        const tLocal = Math.min(1, Math.max(0, (bucketStartMs - start) / localSpan));
        target = live * (1 - 0.8 * tLocal);
        noiseAmplitude = Math.max(1, live * 0.02);
    } else {
        // Normal upward trend - also what "just started" (certus, historyStart far into this range),
        // "has a gap" (redstone, gap applied above), and the large-magnitude matter_ball (scales with
        // `live` regardless of its own magnitude) all use for their real samples.
        target = live * (0.55 + 0.45 * t);
        noiseAmplitude = Math.max(1, live * 0.03);
    }

    const noise = (seededNoise(itemid, fineBucket) - 0.5) * 2 * noiseAmplitude;
    return Math.max(0, Math.round(target + noise));
}

/**
 * Mirrors `GetItemHistory`/`ItemHistoryStore.readSeries`: tier selection by span, absolute
 * `floorDiv`-style buckets, `stepBuckets = ceil(totalBuckets/points)`, each output point is the
 * newest non-gap bucket in its window (never an average). `count` and `stepMillis` are derived here
 * exactly as the server derives them - callers must never assume `count === points`.
 */
export function mockItemHistory(
    grid: MockGrid,
    itemids: string[],
    range: StatsRange,
    pointsRequested: number,
    customMinutes?: number,
): ItemHistoryResult {
    const now = Date.now();
    const rangeMs: Record<Exclude<StatsRange, "custom">, number> = {
        "15m": 15 * 60_000,
        "1h": 60 * 60_000,
        "6h": 6 * 60 * 60_000,
        "24h": 86_400_000,
        "7d": 7 * 86_400_000,
        "30d": 30 * 86_400_000,
        "1y": MOCK_HOURLY_RETENTION_DAYS * 86_400_000,
        all: MOCK_HOURLY_RETENTION_DAYS * 86_400_000,
    };
    const span = range === "custom" ? (customMinutes ?? 60) * 60_000 : rangeMs[range];
    const resolution: "fine" | "hourly" = span <= MOCK_FINE_RETENTION_MS ? "fine" : "hourly";
    const tierBucketMs = resolution === "fine" ? MOCK_SAMPLE_INTERVAL_MS : MOCK_HOURLY_BUCKET_MS;

    const fromBucket = Math.floor((now - span) / tierBucketMs);
    const toBucket = Math.floor(now / tierBucketMs);
    const totalBuckets = toBucket - fromBucket + 1;
    const stepBuckets = totalBuckets <= pointsRequested ? 1 : Math.ceil(totalBuckets / pointsRequested);
    const count = Math.floor((toBucket - fromBucket) / stepBuckets) + 1;
    const stepMillis = stepBuckets * tierBucketMs;

    const series = itemids.map((itemid) => {
        const points: number[] = [];
        for (let i = 0; i < count; i++) {
            const windowStartBucket = fromBucket + i * stepBuckets;
            const windowEndBucket = Math.min(toBucket, windowStartBucket + stepBuckets - 1);
            let value = HISTORY_NO_SAMPLE;
            for (let b = windowEndBucket; b >= windowStartBucket; b--) {
                const v = mockBucketValue(grid, itemid, b * tierBucketMs, now);
                if (v !== HISTORY_NO_SAMPLE) {
                    value = v;
                    break;
                }
            }
            points.push(value);
        }
        return { itemid, points };
    });

    return {
        from: fromBucket * tierBucketMs,
        to: toBucket * tierBucketMs,
        stepMillis,
        resolution,
        limit: MOCK_TRACKED_LIMIT,
        series,
    };
}

interface MockIngredient {
    itemid: string;
    itemname: string;
    /** How much of this ingredient one unit of the output needs, before the `/8` scale-down below. */
    perUnit: number;
    craftable: boolean;
}

/**
 * A handful of the fixture items' "recipes", loosely mirroring their real AE2 sub-crafts closely enough
 * to bucket into all three plan columns (missing/to-craft/from-storage) - not meant to be dimensionally
 * accurate. `DEFAULT_INGREDIENTS` covers every other craftable item in the fixtures.
 */
const MOCK_RECIPE_TREE: Record<string, MockIngredient[]> = {
    "appliedenergistics2:processor_calc": [
        { itemid: "appliedenergistics2:crystal_fluix", itemname: "Fluix Crystal", perUnit: 3, craftable: true },
        {
            itemid: "appliedenergistics2:crystal_certus",
            itemname: "Certus Quartz Crystal",
            perUnit: 4,
            craftable: false,
        },
        { itemid: "appliedenergistics2:material_silicon", itemname: "Silicon", perUnit: 1.5, craftable: true },
        { itemid: "minecraft:redstone", itemname: "Redstone", perUnit: 2.5, craftable: true },
        {
            itemid: "appliedenergistics2:material_calc_processor_press",
            itemname: "Calculation Processor Press",
            perUnit: 0.25,
            craftable: false,
        },
    ],
    "appliedenergistics2:crystal_fluix": [
        {
            itemid: "appliedenergistics2:crystal_certus",
            itemname: "Certus Quartz Crystal",
            perUnit: 1,
            craftable: false,
        },
        { itemid: "minecraft:redstone", itemname: "Redstone", perUnit: 1, craftable: true },
        { itemid: "appliedenergistics2:material_silicon", itemname: "Silicon", perUnit: 1, craftable: true },
    ],
    "minecraft:brick": [{ itemid: "minecraft:raw_iron", itemname: "Raw Iron", perUnit: 4, craftable: false }],
};

const DEFAULT_INGREDIENTS: MockIngredient[] = [
    { itemid: "minecraft:redstone", itemname: "Redstone", perUnit: 1, craftable: true },
    { itemid: "appliedenergistics2:material_silicon", itemname: "Silicon", perUnit: 1, craftable: true },
];

function storedQuantity(gridKey: number, itemid: string): number {
    return findGrid(gridKey)?.items.find((i) => i.itemid === itemid)?.quantity ?? 0;
}

/**
 * Bucketed and sorted the way `Job.java` fills/sorts a real plan (`missing`/`requested`/`stored` are
 * mutually exclusive per row there - see `Job.java:106-122`) so `PlanDetail`'s three columns and sort
 * order are exercisable under `npm run dev`, not just against a real server.
 */
function buildMockPlan(job: MockJob): JobPlanItem[] {
    const match = findItemByHashcode(job.itemHashcode);
    const outputItemid = match?.item.itemid ?? "unknown";
    const outputName = match?.item.itemname ?? "Unknown";
    const ingredients = MOCK_RECIPE_TREE[outputItemid] ?? DEFAULT_INGREDIENTS;

    const rows: JobPlanItem[] = [
        // Job.java's summary always includes the top-level target itself alongside its sub-crafts.
        {
            itemid: outputItemid,
            itemname: outputName,
            stored: 0,
            requested: job.quantity,
            missing: 0,
            steps: 1,
            usedPercent: 0,
        },
    ];

    for (const ing of ingredients) {
        const have = storedQuantity(job.gridKey, ing.itemid);
        const need = Math.max(1, Math.ceil((job.quantity * ing.perUnit) / 8));
        const fromStorage = Math.min(need, have);
        const shortfall = need - fromStorage;
        rows.push({
            itemid: ing.itemid,
            itemname: ing.itemname,
            stored: fromStorage,
            requested: ing.craftable ? shortfall : 0,
            missing: ing.craftable ? 0 : shortfall,
            steps: ing.craftable && shortfall > 0 ? 1 : 0,
            usedPercent: shortfall === 0 && fromStorage > 0 && have > 0 ? fromStorage / have : 0,
        });
    }

    if (job.isSimulating) {
        // A real isSimulating plan means AE2 couldn't fully source *something*; forcing one ingredient's
        // own shortfall large only pushed it into "to craft" when that ingredient happened to be
        // craftable (i.e. most fixture recipes) - a plain synthetic unmet base resource guarantees the
        // Missing column and the "couldn't fully source" notice are always reachable in dev, regardless
        // of which item was ordered.
        rows.push({
            itemid: "minecraft:diamond",
            itemname: "Diamond",
            stored: 0,
            requested: 0,
            missing: Math.max(1, Math.round(job.quantity / 4)),
            steps: 1,
            usedPercent: 0,
        });
    }

    return rows.sort((a, b) => {
        if (a.missing > 0 && b.missing > 0) return b.missing - a.missing;
        if (a.missing > 0 && b.missing === 0) return -1;
        if (a.missing === 0 && b.missing > 0) return 1;
        if (a.requested > 0 && b.requested > 0) return b.steps - a.steps;
        if (a.requested > 0 && b.requested === 0) return -1;
        if (a.requested === 0 && b.requested > 0) return 1;
        return b.stored - a.stored;
    });
}

interface MockJob {
    id: number;
    gridKey: number;
    createdAt: number;
    itemHashcode: number;
    quantity: number;
    isSimulating: boolean;
    /** How long `/job` reports `isDone: false` for - varied so the modal's "Calculating…" state is
     *  actually visible under `npm run dev` instead of always resolving near-instantly. */
    calcDelayMs: number;
}

let nextJobId = 1;
export const mockJobs = new Map<number, MockJob>();

export function createJob(gridKey: number, itemHashcode: number, quantity: number): MockJob {
    const job: MockJob = {
        id: nextJobId++,
        gridKey,
        createdAt: Date.now(),
        itemHashcode,
        quantity,
        // Every 5th order comes back as a simulated (unsubmittable) plan, so the UI has something to exercise.
        isSimulating: nextJobId % 5 === 0,
        calcDelayMs: 900 + Math.round(Math.random() * 1600),
    };
    mockJobs.set(job.id, job);
    return job;
}

export function toJobData(job: MockJob): JobData {
    const isDone = Date.now() - job.createdAt > job.calcDelayMs;
    if (!isDone) return { isDone: false, isSimulating: false, bytesTotal: 0, plan: null };
    return {
        isDone: true,
        isSimulating: job.isSimulating,
        // Real bytesTotal only depends on the plan once computed; the mock keeps the same qty-scaled
        // stand-in `webpage.html`'s prototype used, which already puts some CPUs out of reach at a big
        // enough quantity (exercising the order modal's "invalid" CPU state via the qty stepper alone).
        bytesTotal: job.quantity * 4096,
        plan: buildMockPlan(job),
    };
}
