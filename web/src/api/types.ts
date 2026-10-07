// Mirrors the Java DTOs in core/src/main/java/.../core/api and .../ae2request/{sync,async}.
// Keep field names identical to the server's GSON output - see REDESIGN_MILESTONES.md's
// "What the existing API actually gives us" for the caveats these shapes hide.

export interface Envelope<T> {
    status: string;
    data: T;
}

/** `/grids` entry. `key === -1` is a non-attachable grid, only ever present for admins. */
export interface GridSummary {
    key: number;
    cpuCount: number;
    owner: string;
    isOwned: boolean;
    isTrackingEnabled: boolean;
}

/** `/items?grid=` entry. */
export interface DetailedItem {
    hashcode: number;
    itemid: string;
    itemname: string;
    quantity: number;
    craftable: boolean;
}

/** GSON shape for `IAEGenericStack` (GSONUtils.IAEGenericStackSerializer). */
export interface ItemStack {
    itemid: string;
    itemname: string;
    hashcode: number;
    quantity: number;
}

/** `/list?grid=` entry. Carries no crafting progress - see caveat 2. */
export interface CpuSummary {
    isBusy: boolean;
    finalOutput: ItemStack | null;
    availableStorage: number;
    usedStorage: number;
    coProcessors: number;
    hasTrackingInfo: boolean;
    timeStarted: number;
}

export type CpuList = Record<string, CpuSummary>;

/** Item row inside `/get?grid=&cpu=` (`JSON_CompactedItem`). No `requested` field - see caveat 1. */
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
 * `/get?grid=&cpu=` response. `items` is `null` for an idle CPU (`GetCPU.java` skips the whole busy
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

/** `/order?grid=&item=&quantity=` response. */
export interface OrderResult {
    jobID: number;
}

/** Row inside `/job?grid=&id=`'s `plan`. */
export interface JobPlanItem {
    itemid: string;
    itemname: string;
    stored: number;
    requested: number;
    missing: number;
    steps: number;
    usedPercent: number;
}

/** `/job?grid=&id=` response. `plan` is only present once `isDone`. */
export interface JobData {
    isDone: boolean;
    isSimulating: boolean;
    bytesTotal: number;
    plan: JobPlanItem[] | null;
}

/** `/trackinghistory?grid=` entry. */
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

/** Item row inside `/gettracking?grid=&id=`. */
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

/** `/gettracking?grid=&id=` response. */
export interface TrackingDetail {
    finalOutput: ItemStack;
    timeStarted: number;
    timeDone: number;
    wasCancelled: boolean;
    items: TrackingItem[];
    interfaceShare: InterfaceShare[];
}

/** `/gridsettings?grid=[&track=]` response. `trackedItems` was added alongside M7's history store. */
export interface GridSettingsResult {
    isTracked: boolean;
    trackedItems: string[];
}

/**
 * `range` param shared by `/itemhistory` and (client-side only) the compare modal. `"custom"` carries
 * no span of its own - the span comes from a separate `minutes` param (see `getItemHistory`).
 */
export type StatsRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "1y" | "all" | "custom";

/** Sentinel used in `/itemhistory`'s `points[]` for "no sample in that bucket" - never a stale repeat. */
export const HISTORY_NO_SAMPLE = -1;

/** One item's series inside `/itemhistory`'s response. */
export interface ItemHistorySeries {
    itemid: string;
    points: number[];
}

/**
 * `/itemhistory?grid=&range=&items=&points=` response. `to` is the START of the last bucket, not the
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

/** `/trackeditems?grid=[&set=][&add=][&remove=]` response. `names` (a display name last observed for
 *  each tracked item still in storage) was added alongside the statistics dashboard's icon/name pass -
 *  `undefined` against an older core that doesn't send it yet. */
export interface TrackedItemsResult {
    tracked: string[];
    limit: number;
    names?: Record<string, string>;
}

/** `/prefs` response (M13). `blob` is `null` until this principal has synced from any device; otherwise
 *  it's whatever `state/prefs.tsx` last serialized, verbatim - the server never parses it. */
export interface PrefsResult {
    blob: string | null;
}

// ---- GregTech hub (`/gt/*`) - mirrors docs/gt-hub/phase-1-core.md §5, which is the contract. ----

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

/** `/gt/machines` response. `summary` counts loaded machines only and always carries every status. */
export interface GTMachines {
    scannedAt: number;
    scanMicros: number;
    unloaded: number;
    summary: Record<GTMachineStatus, number>;
    machines: GTMachine[];
}

/** `/gt/machine?id=&range=` response. */
export interface GTMachineDetail {
    machine: GTMachine;
    production: GTProduction;
}

/**
 * One `/gt/power` source. `stored`/`capacity` are decimal strings - they go past 2^53, so keep them as
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

/** `/gt/powerhistory` response. Every series uses `HISTORY_NO_SAMPLE` (-1) for a gap. */
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

/** `/gt/productionhistory` response. `points` are sums per window - 0 means nothing produced, never a gap. */
export interface GTProductionHistory {
    stack: string | null;
    machine: string | null;
    from: number;
    to: number;
    stepMillis: number;
    resolution: "hourly" | "daily";
    points: number[];
}

/** The `/gt/*` `range` param. Like `StatsRange`, `"custom"` takes its span from a separate `minutes`. */
export type GTRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "all" | "custom";
