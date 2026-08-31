// Dev-only fixture data for mock-server.ts. Shapes mirror the real Java DTOs (see src/api/types.ts) -
// keep them in sync as later milestones need richer scenarios.
import type {
    CompactedItem,
    CpuList,
    DetailedItem,
    DimensionalCoords,
    GridSummary,
    ItemStack,
    JobData,
    TrackingDetail,
    TrackingHistoryElement,
} from "../api/types.ts";

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
}

const serverStart = Date.now();

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
                    { itemid: "appliedenergistics2:material_silicon", itemname: "Silicon", requested: 16, stored: 640 },
                    { itemid: "minecraft:redstone", itemname: "Redstone", requested: 48, stored: 3400 },
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
            { hashcode: 2004, itemid: "ae2fc:fluid_drop:lava", itemname: "Lava", quantity: 8000, craftable: false },
        ],
        idleCpus: [{ name: "Outpost CPU", coProcessors: 1, availableStorage: 1024 * 1024 }],
        busyCpus: [],
        history: [],
        trackingDetails: new Map(),
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
            timeStarted: cpu.startedAt,
        };
    }
    return list;
}

export function toCompactedItems(cpu: MockBusyCpu): CompactedItem[] {
    const fraction = craftProgress(cpu);
    const elapsed = Date.now() - cpu.startedAt;
    return cpu.recipe.map((row) => {
        const craftedTotal = Math.min(row.requested, Math.round(row.requested * fraction));
        const remaining = row.requested - craftedTotal;
        const active = remaining > 0 ? Math.min(4, remaining) : 0;
        const pending = Math.max(0, remaining - active);
        // Guards the division-by-zero -> NaN that the real GetCPU.java can hit when timeSpentCrafting is
        // still 0 (see REDESIGN_MILESTONES.md Notes) - the mock should not paper over that shape, only avoid
        // producing an actual NaN in dev JSON (JSON has no NaN literal).
        const timeSpentCrafting = cpu.hasTrackingInfo ? Math.round(elapsed * (row.requested / 64)) : 0;
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

interface MockJob {
    id: number;
    gridKey: number;
    createdAt: number;
    itemHashcode: number;
    quantity: number;
    isSimulating: boolean;
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
    };
    mockJobs.set(job.id, job);
    return job;
}

export function toJobData(job: MockJob): JobData {
    const isDone = Date.now() - job.createdAt > 900;
    if (!isDone) return { isDone: false, isSimulating: false, bytesTotal: 0, plan: null };
    const bytesTotal = job.quantity * 4096;
    return {
        isDone: true,
        isSimulating: job.isSimulating,
        bytesTotal,
        plan: [
            {
                itemid: "appliedenergistics2:crystal_certus",
                itemname: "Certus Quartz Crystal",
                stored: 210,
                requested: 0,
                missing: job.isSimulating ? job.quantity * 2 : 0,
                steps: 1,
                usedPercent: 0,
            },
            {
                itemid: "minecraft:redstone",
                itemname: "Redstone",
                stored: 3400,
                requested: job.quantity,
                missing: 0,
                steps: 1,
                usedPercent: 0,
            },
            {
                itemid: "appliedenergistics2:crystal_fluix",
                itemname: "Fluix Crystal",
                stored: 860,
                requested: 0,
                missing: 0,
                steps: 0,
                usedPercent: 0.12,
            },
        ],
    };
}
