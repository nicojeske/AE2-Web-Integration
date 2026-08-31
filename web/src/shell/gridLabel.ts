import type { GridSummary } from "../api/types";
import type { GridSelection } from "../state/network";

/**
 * The server has no human grid name (see `GetGridList.java` - just `key`, `owner`, `cpuCount`), unlike
 * the design's mocked `label` field. Disambiguate by owner, falling back to the numeric key only when an
 * owner has more than one network.
 */
export function gridOptionLabel(grid: GridSummary, allGrids: GridSummary[]): string {
    if (grid.key === -1) {
        return `Unattached network (${grid.cpuCount} CPU${grid.cpuCount === 1 ? "" : "s"})`;
    }
    const sameOwnerCount = allGrids.filter((g) => g.key !== -1 && g.owner === grid.owner).length;
    return sameOwnerCount > 1 ? `${grid.owner} - #${grid.key}` : grid.owner;
}

export function gridMetaLine(selection: GridSelection, grids: GridSummary[], selectedGrid: GridSummary | null): string {
    if (selection === "all") {
        const count = grids.filter((g) => g.key !== -1).length;
        return `${count} network${count === 1 ? "" : "s"} combined`;
    }
    if (!selectedGrid) return "";
    const cpuWord = selectedGrid.cpuCount === 1 ? "CPU" : "CPUs";
    return `Owner: ${selectedGrid.owner} - ${selectedGrid.cpuCount} ${cpuWord}`;
}
