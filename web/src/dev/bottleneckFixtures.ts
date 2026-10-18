// Mock data for the Bottlenecks section: `/api/grids/{grid}/bottlenecks` and `/api/gt/machine-states`.
// Deterministic, scaled to the requested span, and shaped like a real GTNH base's analysis (one Volcanus
// carrying most of the held time, a circuit assembler behind it, an auto-stocked chemical line).
import type {
    BottleneckIncident,
    BottleneckMachine,
    BottleneckOutput,
    BottleneckRange,
    Bottlenecks,
    GTMachineStates,
    GTMachineStatus,
    ServerTickRate,
    TrackingHistoryElement,
} from "../api/types.ts";
import { GT_STATUS_ORDER } from "../api/types.ts";
import { mockGTMachines } from "./gtFixtures.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const MOCK_CRAFT_RETENTION_DAYS = 365;

export function parseBottleneckRange(range: string | null, minutes: string | null): number | null {
    const presets: Partial<Record<BottleneckRange, number>> = {
        "24h": DAY,
        "7d": 7 * DAY,
        "30d": 30 * DAY,
        "90d": 90 * DAY,
        "1y": 365 * DAY,
        all: MOCK_CRAFT_RETENTION_DAYS * DAY,
    };
    const r = (range ?? "7d") as BottleneckRange;
    if (r === "custom") {
        const n = minutes === null ? NaN : Number(minutes);
        return Number.isInteger(n) && n >= 1 ? Math.min(n * 60_000, MOCK_CRAFT_RETENTION_DAYS * DAY) : null;
    }
    return presets[r] ?? null;
}

/** Stable 0..1 noise per (seed, n). */
function noise(seed: string, n: number): number {
    let h = 2166136261;
    for (const c of `${seed}|${n}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return ((h >>> 0) % 10_000) / 10_000;
}

interface MachineSpec {
    name: string;
    /** Busy hours per day. */
    busy: number;
    /** Fraction of busy time with a second job waiting. */
    queued: number;
    /** Held job-hours per busy hour (can exceed 1 when jobs pile up). */
    held: number;
    p50: number;
    p90: number;
    outputs: [string, string][];
}

const MACHINES: MachineSpec[] = [
    {
        name: "Volc | C1 | NC,11,13,16,17,22,24,Yttrium Oxide",
        busy: 1.8,
        queued: 0.3,
        held: 1.1,
        p50: 47_000,
        p90: 669_000,
        outputs: [
            ["gregtech:gt.metaitem.01:11473", "HSS-S Ingot"],
            ["gregtech:gt.metaitem.01:11028", "Titanium Ingot"],
        ],
    },
    {
        name: "Circ Ass. | IV | Dual | 1",
        busy: 1.3,
        queued: 0.06,
        held: 0.85,
        p50: 4_000,
        p90: 258_000,
        outputs: [["gregtech:gt.metaitem.03:32083", "Any LuV Circuit"]],
    },
    {
        name: "LCR | C2 | #1,12,14,15",
        busy: 0.9,
        queued: 0.02,
        held: 0.55,
        p50: 19_000,
        p90: 31_000,
        outputs: [["gregtech:gt.metaitem.01:30595", "Phthalic Acid"]],
    },
    {
        name: "LCR | C1 | NC,11,13,16,17,18,19,24",
        busy: 0.75,
        queued: 0.03,
        held: 0.3,
        p50: 4_000,
        p90: 6_000,
        outputs: [["gregtech:gt.metaitem.01:30595", "Phthalic Acid"]],
    },
    {
        name: "Compressor | HV",
        busy: 0.22,
        queued: 0.05,
        held: 0.25,
        p50: 900,
        p90: 37_000,
        outputs: [["minecraft:iron_ingot", "Iron Ingot"]],
    },
    {
        name: "Smelter",
        busy: 0.17,
        queued: 0.1,
        held: 0.05,
        p50: 13_000,
        p90: 72_000,
        outputs: [["gregtech:gt.metaitem.01:11019", "Aluminium Ingot"]],
    },
    {
        name: "Wire | #3",
        busy: 0.16,
        queued: 0.12,
        held: 0.09,
        p50: 3_000,
        p90: 17_000,
        outputs: [["gregtech:gt.metaitem.01:19035", "Fine Copper Wire"]],
    },
];

const OUTPUTS: { itemid: string; name: string; jobsPerDay: number; p50: number; starved: number; blocker: number }[] = [
    {
        itemid: "gregtech:gt.metaitem.01:30595",
        name: "Phthalic Acid",
        jobsPerDay: 88,
        p50: 35_000,
        starved: 0.01,
        blocker: 2,
    },
    {
        itemid: "gregtech:gt.metaitem.03:32083",
        name: "Any LuV Circuit",
        jobsPerDay: 3,
        p50: 723_000,
        starved: 0.2,
        blocker: 1,
    },
    {
        itemid: "gregtech:gt.metaitem.01:11473",
        name: "HSS-S Ingot",
        jobsPerDay: 2,
        p50: 1_046_000,
        starved: 0,
        blocker: 0,
    },
    {
        itemid: "gregtech:gt.metaitem.01:11028",
        name: "Titanium Ingot",
        jobsPerDay: 2.7,
        p50: 471_000,
        starved: 0,
        blocker: 0,
    },
    {
        itemid: "gregtech:gt.metaitem.01:11019",
        name: "Aluminium Ingot",
        jobsPerDay: 14,
        p50: 60_000,
        starved: 0.5,
        blocker: 5,
    },
    { itemid: "minecraft:iron_ingot", name: "Iron Ingot", jobsPerDay: 6, p50: 20_000, starved: 0.08, blocker: 4 },
];

export function mockBottlenecks(
    history: TrackingHistoryElement[],
    span: number,
    previous: boolean,
    now: number,
): Bottlenecks {
    const to = Math.floor(now / 60_000) * 60_000 - (previous ? span : 0);
    const from = to - span;
    const bucketMillis = span <= 2 * DAY ? HOUR : span <= 62 * DAY ? DAY : 7 * DAY;
    const firstBucket = Math.floor(from / bucketMillis);
    const buckets = Math.floor(to / bucketMillis) - firstBucket + 1;
    const days = span / DAY;
    // The previous period was a bit worse for the top machine, so the compare view shows an improvement.
    const factor = (seed: string) => (previous ? 1.25 : 1) * (0.85 + 0.3 * noise(seed, Math.floor(to / DAY)));
    const jobIds = history.map((h) => h.id);

    const machines: BottleneckMachine[] = MACHINES.map((spec, index) => {
        const f = factor(spec.name);
        const busyMillis = Math.round(spec.busy * days * HOUR * f);
        const trend = (share: number) =>
            Array.from({ length: buckets }, (_, i) => {
                const start = Math.max(from, (firstBucket + i) * bucketMillis);
                const end = Math.min(to, (firstBucket + i + 1) * bucketMillis);
                const width = Math.max(0, end - start);
                return Math.round(((spec.busy * HOUR) / DAY) * width * share * (0.4 + 1.2 * noise(spec.name, i)));
            });
        const incidents: BottleneckIncident[] =
            index === 0
                ? [
                      {
                          jobId: jobIds[0] ?? 1,
                          itemid: spec.outputs[1]![0],
                          name: spec.outputs[1]![1],
                          started: to - span / 3,
                          durationMillis: 11 * HOUR,
                          kind: "stuck",
                      },
                      {
                          jobId: jobIds[1] ?? 2,
                          itemid: spec.outputs[0]![0],
                          name: spec.outputs[0]![1],
                          started: to - span / 5,
                          durationMillis: 52 * 60_000,
                          kind: "power",
                      },
                  ]
                : index === 1
                  ? [
                        {
                            jobId: jobIds[2] ?? 3,
                            itemid: spec.outputs[0]![0],
                            name: spec.outputs[0]![1],
                            started: to - span / 2,
                            durationMillis: 95 * 60_000,
                            kind: "anomaly",
                        },
                    ]
                  : [];
        return {
            name: spec.name,
            jobs: Math.round(spec.busy * 40 * days),
            intervals: Math.round(spec.busy * 120 * days),
            busyMillis,
            queuedMillis: Math.round(busyMillis * spec.queued),
            heldMillis: Math.round(busyMillis * spec.held),
            utilization: Math.min(1, busyMillis / span),
            p50Millis: spec.p50,
            p90Millis: spec.p90,
            capMillis: Math.max(10 * spec.p50, 3 * spec.p90, spec.p50 + 600_000),
            anomalies: incidents.filter((i) => i.kind === "anomaly").length,
            powerAffected: incidents.filter((i) => i.kind === "power").length,
            stuckAtCancel: incidents.filter((i) => i.kind === "stuck").length,
            trendBusyMillis: trend(1),
            trendQueuedMillis: trend(spec.queued),
            outputs: spec.outputs.map(([itemid, name], i) => ({
                itemid,
                name,
                jobs: Math.max(1, Math.round(spec.busy * 30 * days)) >> i,
            })),
            incidents,
        };
    });
    machines.sort((a, b) => b.heldMillis - a.heldMillis);

    const outputs: BottleneckOutput[] = OUTPUTS.map((o) => {
        const jobs = Math.max(1, Math.round(o.jobsPerDay * days * factor(o.itemid)));
        const cancelled = o.itemid.endsWith("11028") ? Math.ceil(jobs / 10) : 0;
        const completedMillis = (jobs - cancelled) * o.p50;
        return {
            itemid: o.itemid,
            name: o.name,
            jobs,
            cancelled,
            p50Millis: o.p50,
            p90Millis: Math.round(o.p50 * 1.6),
            completedMillis,
            starvedShare: Math.min(1, o.starved * (previous ? 1.2 : 1)),
            topBlocker: MACHINES[o.blocker]?.name ?? null,
            topBlockerMillis: Math.round(completedMillis * (1 - o.starved) * 0.7),
        };
    });
    outputs.sort((a, b) => b.completedMillis - a.completedMillis);
    const jobs = outputs.reduce((sum, o) => sum + o.jobs, 0);
    const cancelled = outputs.reduce((sum, o) => sum + o.cancelled, 0);
    return {
        from,
        to,
        trendFrom: firstBucket * bucketMillis,
        bucketMillis,
        jobs,
        completed: jobs - cancelled,
        cancelled,
        powerData: true,
        machines,
        outputs,
        ...mockMissingIngredients(to, days * (previous ? 0.6 : 1)),
    };
}

const MISSING = [
    {
        itemid: "gregtech:gt.metaitem.01:11305",
        name: "Steel Ingot",
        perDay: 2.5,
        unit: 512,
        blocks: ["Any LuV Circuit", "Aluminium Ingot"],
    },
    {
        itemid: "gregtech:gt.metaitem.01:30595",
        name: "Phthalic Acid",
        perDay: 1.2,
        unit: 4000,
        blocks: ["Phthalic Acid"],
    },
    { itemid: "minecraft:redstone", name: "Redstone", perDay: 0.4, unit: 128, blocks: ["Fine Copper Wire"] },
];

function mockMissingIngredients(to: number, days: number): Pick<Bottlenecks, "failedPlans" | "missingIngredients"> {
    const missingIngredients = MISSING.map((m, i) => {
        const plans = Math.round(m.perDay * days);
        return {
            itemid: m.itemid,
            name: m.name,
            plans,
            amount: plans * m.unit,
            lastSeen: to - (i + 1) * 47 * 60_000,
            blockedOutputs: m.blocks,
        };
    }).filter((m) => m.plans > 0);
    return {
        failedPlans: Math.round(missingIngredients.reduce((sum, m) => sum + m.plans, 0) * 0.7),
        missingIngredients,
    };
}

export function mockGTMachineStates(span: number, now: number): GTMachineStates[] {
    const rows = mockGTMachines(now)
        .machines.filter((m) => m.loaded)
        .map((m, index) => {
            const observed = Math.round(span * (0.7 + 0.3 * noise(m.id, 0)));
            const weights: Partial<Record<GTMachineStatus, number>> = {
                RUNNING: index % 4 === 0 ? 0.95 : 0.3 + 0.5 * noise(m.id, 1),
                IDLE: index % 4 === 0 ? 0.03 : 0.2 + 0.4 * noise(m.id, 2),
                NO_POWER: index % 5 === 1 ? 0.04 : 0,
                OUTPUT_FULL: index % 6 === 2 ? 0.12 : 0,
                MAINTENANCE: index % 7 === 3 ? 0.06 : 0,
            };
            const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
            const states: Record<string, number> = {};
            for (const status of GT_STATUS_ORDER) {
                const w = weights[status] ?? 0;
                if (w > 0) states[status.toLowerCase()] = Math.round((observed * w) / total);
            }
            const observedMillis = Object.values(states).reduce((a, b) => a + b, 0);
            return {
                id: m.id,
                name: m.name,
                ownerName: m.ownerName ?? null,
                voltageTier: m.voltageTier,
                observedMillis,
                runningShare: (states.running ?? 0) / observedMillis,
                states,
            };
        });
    return rows.sort((a, b) => b.runningShare - a.runningShare || a.id.localeCompare(b.id));
}

/** Mostly 20 TPS with an evening lag hump and a few autosave-sized spikes; nothing before the mock server start. */
export function mockServerTickRate(from: number, to: number, points: number): ServerTickRate {
    const fine = to - from <= 2 * 86_400_000;
    const bucket = fine ? 30_000 : 3_600_000;
    const first = Math.floor(from / bucket);
    const buckets = Math.floor((to - 1) / bucket) - first + 1;
    const step = Math.max(1, Math.ceil(buckets / points));
    const windows = Math.ceil(buckets / step);
    const tps: number[] = [];
    const mspt: number[] = [];
    const maxTickMillis: number[] = [];
    for (let w = 0; w < windows; w++) {
        const at = (first + w * step) * bucket;
        const hour = new Date(at).getHours();
        const load = 28 + (hour >= 18 && hour <= 22 ? 30 : 0) + 8 * noise(String(at), 0);
        mspt.push(Math.round(load * 10) / 10);
        tps.push(Math.min(20, Math.round((1000 / Math.max(50, load)) * 100) / 100));
        maxTickMillis.push(Math.round(load * 2 + (noise(String(at), 1) > 0.93 ? 2400 : 0)));
    }
    return {
        from: first * bucket,
        to: (first + (windows - 1) * step) * bucket,
        stepMillis: step * bucket,
        resolution: fine ? "fine" : "hourly",
        tps,
        mspt,
        maxTickMillis,
        currentTps: tps[tps.length - 1] ?? -1,
        currentMspt: mspt[mspt.length - 1] ?? -1,
    };
}
