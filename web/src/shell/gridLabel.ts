import type { GridSummary } from "../api/types";
import type { GridSelection } from "../state/network";

/**
 * The server has no human grid name (see `GetGrids.java` - just `key`, `owner`, `cpuCount`), unlike
 * the design's mocked `label` field. Disambiguate by owner, falling back to a short prefix of the key only
 * when an owner has more than one network.
 */
export function gridOptionLabel(grid: GridSummary, allGrids: GridSummary[]): string {
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
