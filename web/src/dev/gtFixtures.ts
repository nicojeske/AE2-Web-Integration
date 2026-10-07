// Dev-only GregTech hub fixtures for mock-server.ts. Shapes mirror docs/gt-hub/phase-1-core.md §5 (the
// contract) - every machine status, both power kinds and the awkward cases (unloaded machines, another
// player's machine, a wireless network past 2^53 whose rate only shows up from the second poll).
import type {
    GTMachine,
    GTMachines,
    GTMachineStatus,
    GTPowerHistory,
    GTPowerSource,
    GTProduction,
    GTProductionEntry,
    GTProductionHistory,
    GTRange,
    GTStack,
} from "../api/types.ts";
import { GT_STATUS_ORDER, HISTORY_NO_SAMPLE } from "../api/types.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const serverStart = Date.now();

const DEV = { owner: "0f3c2b1a-1111-4222-8333-444455556666", ownerName: "DevAdmin" };
const KUBA = { owner: "7a1e9c44-2222-4333-8444-555566667777", ownerName: "kuba6000" };

/** Mirrors `gt_production_daily_retention_days` / `_hourly_` and `gt_power_*` defaults (phase-1 §7). */
const PRODUCTION_HOURLY_RETENTION = 7 * DAY;
const PRODUCTION_DAILY_RETENTION = 90 * DAY;
const POWER_SAMPLE_MS = 30_000;
const POWER_FINE_RETENTION = 24 * HOUR;
const POWER_HOURLY_RETENTION = 30 * DAY;
/** Long.MAX_VALUE - history series saturate there (phase-1 §3). */
const LONG_MAX = 9.223372036854776e18;

/** Recording started 20 days ago, so 30d/90d/all exercise the "counting since" footer. */
const TRACKING_SINCE = serverStart - 20 * DAY;

const TITANIUM = { id: "gregtech:gt.metaitem.01:11028", name: "Titanium Ingot", fluid: false };
const TUNGSTENSTEEL = { id: "gregtech:gt.metaitem.01:11316", name: "Tungstensteel Ingot", fluid: false };
const ALUMINIUM = { id: "gregtech:gt.metaitem.01:11019", name: "Aluminium Ingot", fluid: false };
// Also an item in fixtures.ts' grids, so the Production -> Statistics cross-link has real history to open.
const IRON_DUST = { id: "mekanism:dust_iron", name: "Dust (Iron)", fluid: false };
const BRICK = { id: "minecraft:brick", name: "Brick", fluid: false };
const HELIUM = { id: "helium", name: "Helium", fluid: true };
const ETHYLENE = { id: "ethylene", name: "Ethylene", fluid: true };
const PROPENE = { id: "propene", name: "Propene", fluid: true };
const ETHANE = { id: "ethane", name: "Ethane", fluid: true };
const POLYETHYLENE = { id: "molten.polyethylene", name: "Molten Polyethylene", fluid: true };

type StackDef = { id: string; name: string; fluid: boolean };

interface MockMachine {
    base: Omit<GTMachine, "id" | "lastSeenMillis" | "loaded" | "outputs" | "progressTicks">;
    /** Per-recipe outputs while running. */
    outputs: (StackDef & { amount: number })[];
    /** Average production per hour - what feeds `/gt/production`. */
    produces: (StackDef & { perHour: number })[];
    /** Unloaded machines: how long ago they were last scanned. */
    unloadedFor?: number;
}

function machine(
    pos: [dim: number, x: number, y: number, z: number],
    name: string,
    type: string,
    status: GTMachineStatus,
    extra: Partial<Omit<MockMachine["base"], "owner" | "ownerName">> & {
        outputs?: MockMachine["outputs"];
        produces?: MockMachine["produces"];
        unloadedFor?: number;
        by?: typeof DEV | null;
    } = {},
): MockMachine {
    const [dim, x, y, z] = pos;
    const { outputs = [], produces = [], unloadedFor, by = DEV, ...rest } = extra;
    return {
        base: {
            dim,
            dimName: dim === 0 ? "Overworld" : "Moon",
            x,
            y,
            z,
            name,
            type,
            owner: by?.owner ?? null,
            ownerName: by?.ownerName ?? null,
            status,
            statusDetail: null,
            maxProgressTicks: 0,
            euPerTick: 0,
            voltageTier: 3,
            efficiency: 10000,
            maintenanceIssues: [],
            ...rest,
        },
        outputs,
        produces,
        unloadedFor,
    };
}

const MOCK_MACHINES: MockMachine[] = [
    machine([0, 120, 64, -340], "Electric Blast Furnace", "multimachine.blastfurnace", "RUNNING", {
        maxProgressTicks: 1200,
        euPerTick: 7680,
        voltageTier: 5,
        outputs: [{ ...TITANIUM, amount: 1 }],
        produces: [{ ...TITANIUM, perHour: 24 }],
    }),
    machine([0, 130, 64, -340], "Vacuum Freezer", "multimachine.vacuumfreezer", "MAINTENANCE", {
        statusDetail: "Maintenance required",
        voltageTier: 4,
        efficiency: 8000,
        maintenanceIssues: ["Wrench", "Soft Mallet"],
        produces: [
            { ...HELIUM, perHour: 4000 },
            { ...TITANIUM, perHour: 6 },
        ],
    }),
    machine([0, 140, 64, -340], "Assembling Line", "multimachine.assemblyline", "STRUCTURE_INCOMPLETE", {
        statusDetail: "Structure incomplete",
        voltageTier: 6,
        efficiency: 0,
    }),
    machine([0, 150, 64, -340], "Distillation Tower", "multimachine.distillationtower", "OUTPUT_FULL", {
        statusDetail: "Item output full",
        voltageTier: 3,
        produces: [
            { ...ETHYLENE, perHour: 12000 },
            { ...PROPENE, perHour: 6000 },
        ],
    }),
    machine([0, 160, 64, -340], "Implosion Compressor", "multimachine.implosioncompressor", "NO_POWER", {
        statusDetail: "Not enough power",
        voltageTier: 3,
    }),
    machine([0, 170, 64, -340], "Large Chemical Reactor", "multimachine.chemicalreactor", "STOPPED", {
        statusDetail: "Out of fluid: Oxygen",
        voltageTier: 4,
        produces: [{ ...POLYETHYLENE, perHour: 1440 }],
    }),
    machine([0, 180, 64, -340], "Pyrolyse Oven", "multimachine.pyro", "DISABLED", {
        statusDetail: "Disabled",
        voltageTier: 2,
    }),
    machine([0, 190, 64, -340], "Multi Smelter", "multimachine.multifurnace", "IDLE", {
        statusDetail: "No valid recipe found",
        voltageTier: 2,
        produces: [{ ...BRICK, perHour: 300 }],
    }),
    machine(
        [0, 200, 64, -340],
        "Industrial Maceration Stack",
        "industrialmacerator.controller.tier.single",
        "RUNNING",
        {
            maxProgressTicks: 160,
            euPerTick: 480,
            voltageTier: 4,
            efficiency: 10000,
            outputs: [{ ...IRON_DUST, amount: 16 }],
            produces: [{ ...IRON_DUST, perHour: 900 }],
        },
    ),
    machine([0, 210, 64, -340], "Oil Cracking Unit", "multimachine.cracker", "RUNNING", {
        maxProgressTicks: 400,
        euPerTick: 1920,
        voltageTier: 4,
        outputs: [{ ...ETHANE, amount: 1000 }],
        produces: [{ ...ETHANE, perHour: 8000 }],
    }),
    machine([0, 100, 64, -300], "Lapotronic Supercapacitor", "multimachine.supercapacitor", "IDLE", {
        voltageTier: -1,
    }),
    machine([0, 100, 64, -260], "Lapotronic Supercapacitor", "multimachine.supercapacitor", "IDLE", {
        voltageTier: -1,
    }),
    machine([-28, 40, 70, 12], "Mega Blast Furnace", "megablastfurnace", "RUNNING", {
        maxProgressTicks: 2400,
        euPerTick: 491520,
        voltageTier: 7,
        outputs: [{ ...TUNGSTENSTEEL, amount: 48 }],
        produces: [{ ...TUNGSTENSTEEL, perHour: 48 }],
    }),
    machine([-28, 60, 70, 12], "Cleanroom", "multimachine.cleanroom", "RUNNING", {
        maxProgressTicks: 100,
        euPerTick: 30,
        voltageTier: 1,
    }),
    machine([0, -500, 70, 900], "Large Combustion Engine", "multimachine.largecombustionengine", "RUNNING", {
        maxProgressTicks: 20,
        euPerTick: -2048,
        voltageTier: 4,
        unloadedFor: 3 * HOUR,
    }),
    machine([-28, -80, 70, 40], "Industrial Sifter", "industrialsifter.controller.tier.single", "IDLE", {
        voltageTier: 3,
        unloadedFor: 26 * HOUR,
    }),
    machine([0, 900, 72, 900], "Electric Blast Furnace", "multimachine.blastfurnace", "RUNNING", {
        maxProgressTicks: 600,
        euPerTick: 1920,
        voltageTier: 3,
        by: KUBA,
        outputs: [{ ...ALUMINIUM, amount: 2 }],
        produces: [{ ...ALUMINIUM, perHour: 64 }],
    }),
];

function machineId(m: MockMachine): string {
    return `${m.base.dim}:${m.base.x}:${m.base.y}:${m.base.z}`;
}

// ---- deterministic noise (same scheme as fixtures.ts' seededNoise) ----

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function noise(key: string, bucket: number): number {
    let h = (hashString(key) ^ Math.imul(bucket, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4_294_967_296;
}

// ---- machines ----

function toMachine(m: MockMachine, now: number): GTMachine {
    const loaded = m.unloadedFor === undefined;
    const lastSeen = loaded ? scanTime(now) : serverStart - m.unloadedFor!;
    const running = m.base.status === "RUNNING";
    const max = running ? m.base.maxProgressTicks : 0;
    // Advances by real time between polls, so progress bars visibly move in the dev UI.
    const progressTicks = max > 0 ? Math.floor((lastSeen - serverStart) / 50 + hashString(machineId(m))) % max : 0;
    const outputs: GTStack[] = running
        ? m.outputs.map(({ id, name, amount, fluid }) => ({ id, name, amount, fluid }))
        : [];
    return {
        ...m.base,
        id: machineId(m),
        maxProgressTicks: max,
        progressTicks,
        euPerTick: running || m.base.status === "IDLE" ? m.base.euPerTick : 0,
        outputs,
        lastSeenMillis: lastSeen,
        loaded,
    };
}

/** Scans happen every 10 s (`gt_scan_interval_seconds`) - snap to that so `scannedAt` behaves. */
function scanTime(now: number): number {
    return now - ((now - serverStart) % 10_000);
}

export function mockGTMachines(now: number): GTMachines {
    const machines = MOCK_MACHINES.map((m) => toMachine(m, now));
    const statusIndex = (s: GTMachineStatus) => GT_STATUS_ORDER.indexOf(s);
    machines.sort(
        (a, b) =>
            Number(b.loaded) - Number(a.loaded) ||
            statusIndex(a.status) - statusIndex(b.status) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
    );
    const summary = Object.fromEntries(GT_STATUS_ORDER.map((s) => [s, 0])) as Record<GTMachineStatus, number>;
    for (const m of machines) if (m.loaded) summary[m.status]++;
    return {
        scannedAt: scanTime(now),
        scanMicros: 900 + Math.floor(noise("scan", Math.floor(now / 10_000)) * 600),
        unloaded: machines.filter((m) => !m.loaded).length,
        summary,
        machines,
    };
}

export function findMockMachine(id: string, now: number): GTMachine | undefined {
    const m = MOCK_MACHINES.find((x) => machineId(x) === id);
    return m && toMachine(m, now);
}

// ---- ranges ----

/** Span in ms for a range, mirroring `GTRequest.parseRange`; `null` = BAD_PARAM. */
export function parseGTRange(
    range: string | null,
    minutes: string | null,
    fallback: GTRange,
    maxMillis: number,
): number | null {
    const r = (range ?? fallback) as GTRange;
    const presets: Partial<Record<GTRange, number>> = {
        "15m": 15 * MINUTE,
        "1h": HOUR,
        "6h": 6 * HOUR,
        "24h": DAY,
        "7d": 7 * DAY,
        "30d": 30 * DAY,
        "90d": 90 * DAY,
        all: maxMillis,
    };
    let span: number | undefined;
    if (r === "custom") {
        const n = minutes === null ? NaN : Number(minutes);
        if (!Number.isInteger(n) || n < 1) return null;
        span = n * MINUTE;
    } else {
        span = presets[r];
    }
    return span === undefined ? null : Math.min(span, maxMillis);
}

export function parsePoints(raw: string | null): number | null {
    if (raw === null) return 120;
    const n = Number(raw);
    if (!Number.isInteger(n)) return null;
    return Math.min(500, Math.max(1, n));
}

// ---- power ----

interface MockPowerSource {
    id: string;
    kind: "LSC" | "WIRELESS";
    name: string;
    owner: typeof DEV;
    capacity: number | null;
    /** EU/t averages, null for wireless. */
    avgIn: number | null;
    avgOut: number | null;
    /** Stored EU at `t` (ms) - a drift plus a slow sine, clamped to the capacity. */
    storedAt: (t: number) => number;
    /** History starts here (earlier windows are gaps). */
    since: number;
    pos: [number, number, number, number] | null;
}

function lscStored(capacity: number, fillAtStart: number, netPerTick: number, phase: number) {
    return (t: number) => {
        const drift = netPerTick * 20 * ((t - serverStart) / 1000);
        const wave = capacity * 0.03 * Math.sin((2 * Math.PI * (t - serverStart)) / (6 * HOUR) + phase);
        return Math.max(0, Math.min(capacity, capacity * fillAtStart + drift + wave));
    };
}

const WIRELESS_BASE = 123456789012345678901234567890n;
const WIRELESS_NET = 2_500_000;

const MOCK_POWER: MockPowerSource[] = [
    {
        id: "lsc:0:100:64:-300",
        kind: "LSC",
        name: "Lapotronic Supercapacitor",
        owner: DEV,
        capacity: 12_000_000_000,
        avgIn: 18_000,
        avgOut: 30_000,
        storedAt: lscStored(12_000_000_000, 0.4, -12_000, 0),
        since: serverStart - 40 * DAY,
        pos: [0, 100, 64, -300],
    },
    {
        id: "lsc:0:100:64:-260",
        kind: "LSC",
        name: "Lapotronic Supercapacitor",
        owner: DEV,
        capacity: 160_000_000_000,
        avgIn: 52_000,
        avgOut: 22_000,
        storedAt: lscStored(160_000_000_000, 0.7, 30_000, 1.3),
        since: serverStart - 3 * DAY,
        pos: [0, 100, 64, -260],
    },
    {
        id: `wireless:${DEV.owner}`,
        kind: "WIRELESS",
        name: `Wireless EU (${DEV.ownerName})`,
        owner: DEV,
        capacity: null,
        avgIn: null,
        avgOut: null,
        storedAt: (t) => Number(WIRELESS_BASE) + WIRELESS_NET * 20 * ((t - serverStart) / 1000),
        since: serverStart - 10 * DAY,
        pos: null,
    },
];

/** The real server has no wireless rate until two scans exist - the first `/gt/power` poll shows that. */
let powerPolls = 0;

function wirelessStored(t: number): bigint {
    return WIRELESS_BASE + BigInt(Math.floor(WIRELESS_NET * 20 * ((t - serverStart) / 1000)));
}

export function mockGTPower(now: number): GTPowerSource[] {
    powerPolls++;
    const t = scanTime(now);
    return MOCK_POWER.map((p) => {
        const stored = p.kind === "WIRELESS" ? wirelessStored(t) : BigInt(Math.round(p.storedAt(t)));
        const net = p.avgIn !== null && p.avgOut !== null ? p.avgIn - p.avgOut : powerPolls > 1 ? WIRELESS_NET : null;
        const storedNum = Number(stored);
        return {
            id: p.id,
            kind: p.kind,
            name: p.name,
            owner: p.owner.owner,
            ownerName: p.owner.ownerName,
            stored: stored.toString(),
            capacity: p.capacity === null ? null : String(p.capacity),
            fill: p.capacity === null ? null : storedNum / p.capacity,
            avgInPerTick: p.avgIn,
            avgOutPerTick: p.avgOut,
            netPerTick: net,
            secondsToEmpty: net !== null && net < 0 ? Math.round(storedNum / (-net * 20)) : null,
            secondsToFull:
                net !== null && net > 0 && p.capacity !== null
                    ? Math.round((p.capacity - storedNum) / (net * 20))
                    : null,
            dim: p.pos?.[0] ?? null,
            x: p.pos?.[1] ?? null,
            y: p.pos?.[2] ?? null,
            z: p.pos?.[3] ?? null,
            sampledAt: t,
            loaded: true,
        };
    });
}

export function hasMockPowerSource(id: string): boolean {
    return MOCK_POWER.some((p) => p.id === id);
}

export const MOCK_POWER_MAX_RANGE = POWER_HOURLY_RETENTION;

export function mockGTPowerHistory(source: string, span: number, points: number, now: number): GTPowerHistory {
    const p = MOCK_POWER.find((x) => x.id === source)!;
    const fine = span <= POWER_FINE_RETENTION;
    const bucket = fine ? POWER_SAMPLE_MS : HOUR;
    const buckets = Math.max(1, Math.ceil(span / bucket));
    const step = bucket * Math.ceil(buckets / points);
    const count = Math.max(1, Math.ceil(span / step));
    const to = Math.floor(now / step) * step;
    const from = to - (count - 1) * step;
    const stored: number[] = [];
    const avgIn: number[] = [];
    const avgOut: number[] = [];
    for (let i = 0; i < count; i++) {
        // Each point is the newest sample in its window - take the window's end, capped at now.
        const t = Math.min(from + i * step + step - 1, now);
        if (t < p.since) {
            stored.push(HISTORY_NO_SAMPLE);
            avgIn.push(HISTORY_NO_SAMPLE);
            avgOut.push(HISTORY_NO_SAMPLE);
            continue;
        }
        stored.push(Math.min(LONG_MAX, Math.round(p.storedAt(t))));
        const jitter = 0.85 + 0.3 * noise(p.id, Math.floor(t / bucket));
        avgIn.push(p.avgIn === null ? HISTORY_NO_SAMPLE : Math.round(p.avgIn * jitter));
        avgOut.push(p.avgOut === null ? HISTORY_NO_SAMPLE : Math.round(p.avgOut * (2 - jitter)));
    }
    return { source, from, to, stepMillis: step, resolution: fine ? "fine" : "hourly", stored, avgIn, avgOut };
}

// ---- production ----

/** Units produced by one machine/stack in the hour starting at `hourStart`. ~15% of hours are zero. */
function producedInHour(m: MockMachine, s: MockMachine["produces"][number], hourStart: number): number {
    if (hourStart < TRACKING_SINCE) return 0;
    const n = noise(`${machineId(m)}|${s.id}`, Math.floor(hourStart / HOUR));
    if (n < 0.15) return 0;
    return Math.round(s.perHour * (0.6 + 0.8 * n));
}

function producedIn(m: MockMachine, s: MockMachine["produces"][number], from: number, to: number): number {
    let total = 0;
    for (let h = from; h < to; h += HOUR) total += producedInHour(m, s, h);
    return total;
}

export const MOCK_PRODUCTION_MAX_RANGE = PRODUCTION_DAILY_RETENTION;

function productionBucket(span: number): { bucket: number; resolution: "hourly" | "daily" } {
    return span <= PRODUCTION_HOURLY_RETENTION
        ? { bucket: HOUR, resolution: "hourly" }
        : { bucket: DAY, resolution: "daily" };
}

export function mockGTProduction(
    span: number,
    groupBy: "item" | "machine",
    machine: string | null,
    now: number,
): GTProduction {
    const { bucket, resolution } = productionBucket(span);
    // `from` is the start of the first WHOLE bucket counted (phase-1 §5).
    const from = Math.floor((now - span) / bucket) * bucket;
    const to = now;
    const spanMillis = Math.max(5 * MINUTE, to - Math.max(from, TRACKING_SINCE));
    const hours = spanMillis / HOUR;
    const entry = (key: string, name: string, fluid: boolean, total: number): GTProductionEntry => ({
        key,
        name,
        fluid,
        total,
        perHour: Math.round((total / hours) * 100) / 100,
        breakdown: [],
    });

    const cells: { m: MockMachine; s: StackDef; total: number }[] = [];
    for (const m of MOCK_MACHINES) {
        if (machine !== null && machineId(m) !== machine) continue;
        for (const s of m.produces) {
            const total = producedIn(m, s, Math.floor(from / HOUR) * HOUR, to);
            if (total > 0) cells.push({ m, s, total });
        }
    }

    const groups = new Map<string, GTProductionEntry>();
    for (const { m, s, total } of cells) {
        const [key, name, fluid] = groupBy === "item" ? [s.id, s.name, s.fluid] : [machineId(m), m.base.name, false];
        let row = groups.get(key);
        if (!row) {
            row = entry(key, name, fluid, 0);
            groups.set(key, row);
        }
        row.total += total;
        row.breakdown.push(
            groupBy === "item" ? entry(machineId(m), m.base.name, false, total) : entry(s.id, s.name, s.fluid, total),
        );
    }
    const rows = [...groups.values()].map((r) => ({
        ...entry(r.key, r.name, r.fluid, r.total),
        breakdown: r.breakdown.sort((a, b) => b.total - a.total),
    }));
    rows.sort((a, b) => b.total - a.total);
    return { from, to, spanMillis, trackingSince: TRACKING_SINCE, resolution, groupBy, rows };
}

export function mockGTProductionHistory(
    item: string | null,
    machine: string | null,
    span: number,
    points: number,
    now: number,
): GTProductionHistory {
    const { bucket, resolution } = productionBucket(span);
    const buckets = Math.max(1, Math.ceil(span / bucket));
    const step = bucket * Math.ceil(buckets / points);
    const count = Math.max(1, Math.ceil(span / step));
    const to = Math.floor(now / step) * step;
    const from = to - (count - 1) * step;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        const start = from + i * step;
        let sum = 0;
        for (const m of MOCK_MACHINES) {
            if (machine !== null && machineId(m) !== machine) continue;
            for (const s of m.produces) {
                if (item !== null && s.id !== item) continue;
                sum += producedIn(m, s, start, Math.min(start + step, now));
            }
        }
        out.push(sum);
    }
    return { stack: item, machine, from, to, stepMillis: step, resolution, points: out };
}
