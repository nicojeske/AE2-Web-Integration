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

/** `/get?grid=&cpu=` response. */
export interface CpuDetail {
    size: number;
    isBusy: boolean;
    finalOutput: ItemStack | null;
    items: CompactedItem[];
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

/** `/gridsettings?grid=[&track=]` response. */
export interface GridSettingsResult {
    isTracked: boolean;
}
