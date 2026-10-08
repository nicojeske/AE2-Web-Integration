// Mirrors the Java DTOs behind core's /api router (core/src/main/java/.../core/http/endpoint and .../api).
// Keep field names identical to the server's GSON output; `./gradlew generateApiDocs` writes the full
// OpenAPI description of every shape here.

export interface Envelope<T> {
    status: string;
    data: T;
}

/** Persistent grid identifier (a `StableKey` token), stable across restarts. */
export type GridKey = string;

/** A player granted access to a grid, and where from. */
export interface GridAccessSource {
    player: { uuid: string; name: string };
    kind: string;
    position: DimensionalCoords;
    side: string | null;
    reason: string;
}

/** `GET /api/grids` entry. */
export interface GridSummary {
    key: GridKey;
    cpuCount: number;
    owner: string;
    isOwned: boolean;
    isTrackingEnabled: boolean;
    /** Players with explicit access, keyed by UUID. */
    accessSources: Record<string, GridAccessSource[]>;
}

/** `GET /api/grids/{gridKey}/items` entry. */
export interface DetailedItem {
    /** Stable resource identity used to order the item; `null` when `identityStatus` says why not. */
    itemKey: string | null;
    /** `AMBIGUOUS`, `UNSUPPORTED` or `UNAVAILABLE` when the item has no usable `itemKey`. */
    identityStatus: string | null;
    itemid: string;
    itemname: string;
    quantity: number;
    craftable: boolean;
}

/** `JSON_Stack`: a resource and an amount. */
export interface ItemStack {
    itemid: string;
    itemname: string;
    itemKey: string | null;
    quantity: number;
}

/** `GET /api/grids/{gridKey}/cpus` entry, keyed by CPU key. Carries no crafting progress - see caveat 2. */
export interface CpuSummary {
    /** Display name; not unique - address CPUs by their key. */
    name: string;
    isBusy: boolean;
    finalOutput: ItemStack | null;
    availableStorage: number;
    usedStorage: number;
    coProcessors: number;
    hasTrackingInfo: boolean;
    timeStarted: number;
}

export type CpuList = Record<string, CpuSummary>;

/** Item row inside `GET /api/grids/{gridKey}/cpus/{cpuKey}` (`JSON_CompactedItem`). No `requested` field - see caveat 1. */
export interface CompactedItem {
    itemid: string;
    itemname: string;
    active: number;
    pending: number;
    stored: number;
    timeSpentCrafting: number;
    craftedTotal: number;
    shareInCraftingTime: number;
    shareInCraftingTimeCombined: number;
    craftsPerSec: number;
}

/**
 * `GET /api/grids/{gridKey}/cpus/{cpuKey}` response. `items` is `null` for an idle CPU (`GetCPU.java` skips the whole busy
 * block entirely) - not `[]`, and not absent, since `GSON_BUILDER` serializes nulls.
 */
export interface CpuDetail {
    size: number;
    isBusy: boolean;
    finalOutput: ItemStack | null;
    items: CompactedItem[] | null;
    hasTrackingInfo: boolean;
    timeStarted: number;
    timeElapsed: number;
}

/** `POST /api/grids/{gridKey}/crafting-plans` response. */
export interface OrderResult {
    jobID: number;
}

/** Row inside a crafting plan's `plan`. */
export interface JobPlanItem {
    itemid: string;
    itemname: string;
    stored: number;
    requested: number;
    missing: number;
    steps: number;
    usedPercent: number;
}

/** `GET /api/grids/{gridKey}/crafting-plans/{planId}` response. `plan` is only present once `isDone`. */
export interface JobData {
    isDone: boolean;
    isSimulating: boolean;
    bytesTotal: number;
    plan: JobPlanItem[] | null;
}

/** `GET /api/grids/{gridKey}/crafting-history` entry. */
export interface TrackingHistoryElement {
    id: number;
    timeStarted: number;
    timeDone: number;
    wasCancelled: boolean;
    finalOutput: ItemStack;
}

export interface TrackingTiming {
    started: number;
    ended: number;
}

/** Item row inside a crafting-history entry. */
export interface TrackingItem {
    itemid: string;
    itemname: string;
    timeSpentOn: number;
    craftedTotal: number;
    shareInCraftingTime: number;
    shareInCraftingTimeCombined: number;
    craftsPerSec: number;
    timings: TrackingTiming[];
}

export interface DimensionalCoords {
    dimid: string;
    x: number;
    y: number;
    z: number;
}

export interface InterfaceShare {
    name: string;
    timings: TrackingTiming[];
    timingsCombined: number;
    location: DimensionalCoords[];
}

/** `GET /api/grids/{gridKey}/crafting-history/{entryId}` response. */
export interface TrackingDetail {
    finalOutput: ItemStack;
    timeStarted: number;
    timeDone: number;
    wasCancelled: boolean;
    items: TrackingItem[];
    interfaceShare: InterfaceShare[];
}

/** `GET|PATCH /api/grids/{gridKey}/settings` response. */
export interface GridSettingsResult {
    isTracked: boolean;
    trackedItems: string[];
    trackedItemNames: Record<string, string>;
}

/**
 * `range` param shared by the item-history endpoint and (client-side only) the compare modal. `"custom"` carries
 * no span of its own - the span comes from a separate `minutes` param (see `getItemHistory`).
 */
export type StatsRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "1y" | "all" | "custom";

/** Sentinel used in the item-history endpoint's `points[]` for "no sample in that bucket" - never a stale repeat. */
export const HISTORY_NO_SAMPLE = -1;

/** One item's series inside the item-history endpoint's response. */
export interface ItemHistorySeries {
    itemid: string;
    points: number[];
}

/**
 * `GET /api/grids/{gridKey}/item-history` response. `to` is the START of the last bucket, not the
 * last point's timestamp; `series[].points.length` can be less than the requested `points` - always
 * derive point count/timestamps from the response, never from the request (REDESIGN_MILESTONES.md M7).
 */
export interface ItemHistoryResult {
    from: number;
    to: number;
    stepMillis: number;
    resolution: "fine" | "hourly";
    limit: number;
    series: ItemHistorySeries[];
}

/** `/api/grids/{gridKey}/tracked-items` response. `names` holds the display name last observed for each
 *  tracked item, so one that emptied out of storage still shows a real name. */
export interface TrackedItemsResult {
    tracked: string[];
    limit: number;
    names: Record<string, string>;
}

/** `/api/prefs` response. `blob` is `null` until this principal has synced from any device; otherwise
 *  it's whatever `state/prefs.tsx` last serialized, verbatim - the server never parses it. */
export interface PrefsResult {
    blob: string | null;
}

// ---- GregTech hub (`/api/gt/*`) - mirrors docs/gt-hub/phase-1-core.md §5, which is the contract. ----

/** Declaration order is the UI sort order (problems first) - same as `GTMachineStatus.java`. */
export type GTMachineStatus =
    "STRUCTURE_INCOMPLETE" | "MAINTENANCE" | "NO_POWER" | "OUTPUT_FULL" | "STOPPED" | "DISABLED" | "IDLE" | "RUNNING";

export const GT_STATUS_ORDER: GTMachineStatus[] = [
    "STRUCTURE_INCOMPLETE",
    "MAINTENANCE",
    "NO_POWER",
    "OUTPUT_FULL",
    "STOPPED",
    "DISABLED",
    "IDLE",
    "RUNNING",
];

/** Statuses that count towards the sidebar's Machines badge. DISABLED is deliberate, so it isn't one. */
export const GT_PROBLEM_STATUSES = new Set<GTMachineStatus>([
    "STRUCTURE_INCOMPLETE",
    "MAINTENANCE",
    "NO_POWER",
    "OUTPUT_FULL",
    "STOPPED",
]);

/** `id` matches `DetailedItem.itemid` for the same item (items) or is the fluid name (fluids, amount in L). */
export interface GTStack {
    id: string;
    name: string;
    amount: number;
    fluid: boolean;
}

export interface GTMachine {
    /** `"dim:x:y:z"` of the controller. */
    id: string;
    dim: number;
    dimName: string | null;
    x: number;
    y: number;
    z: number;
    name: string;
    type: string;
    /** `null` = admin-only. */
    owner: string | null;
    ownerName: string | null;
    status: GTMachineStatus;
    statusDetail: string | null;
    progressTicks: number;
    maxProgressTicks: number;
    /** Positive = consumes, negative = generates. */
    euPerTick: number;
    /** Index into `GT_TIERS`; -1 = unknown. */
    voltageTier: number;
    /** 0..10000. */
    efficiency: number;
    maintenanceIssues: string[];
    outputs: GTStack[];
    lastSeenMillis: number;
    loaded: boolean;
}

/** `/api/gt/machines` response. `summary` counts loaded machines only and always carries every status. */
export interface GTMachines {
    scannedAt: number;
    scanMicros: number;
    unloaded: number;
    summary: Record<GTMachineStatus, number>;
    machines: GTMachine[];
    /** Listed machines that kept producing the same set of outputs lately - candidates to mark passive. */
    suggestedPassive?: string[];
}

/** `/api/gt/machines/{machineId}` response. */
export interface GTMachineDetail {
    machine: GTMachine;
    production: GTProduction;
}

/**
 * One `/api/gt/power` source. `stored`/`capacity` are decimal strings - they go past 2^53, so keep them as
 * `BigInt` for exact text and only take `Number()` for ratios and charts.
 */
export interface GTPowerSource {
    id: string;
    kind: "LSC" | "WIRELESS";
    name: string;
    owner: string | null;
    ownerName: string | null;
    stored: string;
    capacity: string | null;
    /** 0..1, null without a capacity. */
    fill: number | null;
    avgInPerTick: number | null;
    avgOutPerTick: number | null;
    /** Null until two scans exist when the source has no averages of its own (wireless). */
    netPerTick: number | null;
    secondsToEmpty: number | null;
    secondsToFull: number | null;
    dim: number | null;
    x: number | null;
    y: number | null;
    z: number | null;
    sampledAt: number;
    loaded: boolean;
}

export interface GTPower {
    sources: GTPowerSource[];
}

/** `/api/gt/power/{sourceId}/history` response. Every series uses `HISTORY_NO_SAMPLE` (-1) for a gap. */
export interface GTPowerHistory {
    source: string;
    from: number;
    to: number;
    stepMillis: number;
    resolution: "fine" | "hourly";
    stored: number[];
    avgIn: number[];
    avgOut: number[];
}

/** A production row: an item or fluid (`groupBy=item`) or a machine (`groupBy=machine`). */
export interface GTProductionEntry {
    key: string;
    name: string;
    /** Always `false` on machine rows. */
    fluid: boolean;
    total: number;
    perHour: number;
    breakdown: GTProductionEntry[];
}

export interface GTProduction {
    from: number;
    to: number;
    spanMillis: number;
    trackingSince: number;
    resolution: "hourly" | "daily";
    groupBy: "item" | "machine";
    rows: GTProductionEntry[];
}

/** `/api/gt/production/history` response. `points` are sums per window - 0 means nothing produced, never a gap. */
export interface GTProductionHistory {
    stack: string | null;
    machine: string | null;
    from: number;
    to: number;
    stepMillis: number;
    resolution: "hourly" | "daily";
    points: number[];
}

/** The `/api/gt/*` `range` param. Like `StatsRange`, `"custom"` takes its span from a separate `minutes`. */
export type GTRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "all" | "custom";
