import type { GridSummary } from "../api/types";
import type { GridSelection } from "../state/network";

/**
 * The grid's given name; an unnamed grid is labelled by owner, plus a short prefix of the key only when that
 * owner has more than one network.
 */
export function gridOptionLabel(grid: GridSummary, allGrids: GridSummary[]): string {
    if (grid.name) return grid.name;
    return gridFallbackLabel(grid, allGrids);
}

/** The label an unnamed grid gets - also the rename field's placeholder. */
export function gridFallbackLabel(grid: GridSummary, allGrids: GridSummary[]): string {
    const sameOwnerCount = allGrids.filter((g) => g.owner === grid.owner).length;
    return sameOwnerCount > 1 ? `${grid.owner} - #${grid.key.slice(0, 6)}` : grid.owner;
}

export function gridMetaLine(selection: GridSelection, grids: GridSummary[], selectedGrid: GridSummary | null): string {
    if (selection === "all") {
        const count = grids.length;
        return `${count} network${count === 1 ? "" : "s"} combined`;
    }
    if (!selectedGrid) return "";
    const cpuWord = selectedGrid.cpuCount === 1 ? "CPU" : "CPUs";
    return `Owner: ${selectedGrid.owner} - ${selectedGrid.cpuCount} ${cpuWord}`;
}
