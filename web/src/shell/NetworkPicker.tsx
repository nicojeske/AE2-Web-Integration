// The network `<select>` + tracking checkbox, extracted out of Sidebar (M11) so the responsive shell can
// render it twice: once inline in the sidebar (>=1024px) and once in the topbar's own row (<1024px,
// where the sidebar collapses to an icon rail or an off-canvas drawer and has no room left for it).
import { useEffect, useState } from "preact/hooks";

import { ApiError, setGridTracking } from "../api/client";
import type { GridSummary } from "../api/types";
import { useNetwork } from "../state/network";
import type { GridSelection } from "../state/network";
import { useToast } from "../state/toast";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { gridMetaLine, gridOptionLabel } from "./gridLabel";

export interface NetworkPickerProps {
    className?: string;
    /** `"topbar"` visually hides the "Network" label (redundant next to the section title) but keeps it
     *  in the DOM for screen readers. Defaults to the sidebar's own full layout. */
    variant?: "sidebar" | "topbar";
}

/**
 * `gridsettings?track=` is the only way to switch tracking on anywhere in the mod, and tracking gates
 * the craft-detail progress UI, the bottleneck panel and the whole Crafting History section - kept as a
 * deliberate deviation from the design (see the M3/M5 notes this repo used to track in
 * REDESIGN_MILESTONES.md before it was retired).
 */
function GridTrackingCheckbox({ grid, onTracked }: { grid: GridSummary; onTracked: () => Promise<void> }) {
    const toast = useToast();
    const [checked, setChecked] = useState(grid.isTrackingEnabled);

    // Re-seed when the selected grid changes (including after selectGrid to a different network).
    useEffect(() => {
        setChecked(grid.isTrackingEnabled);
    }, [grid.key, grid.isTrackingEnabled]);

    const onChange = async (next: boolean) => {
        setChecked(next);
        try {
            const result = await setGridTracking(grid.key, next);
            setChecked(result.isTracked);
            await onTracked();
        } catch (e) {
            setChecked(grid.isTrackingEnabled);
            toast(e instanceof ApiError ? e.status : "Failed to update tracking");
        }
    };

    return (
        <Checkbox checked={checked} onChange={(next) => void onChange(next)}>
            <span className="network-picker__tracking-label">Enable tracking for this grid</span>
        </Checkbox>
    );
}

export function NetworkPicker({ className, variant = "sidebar" }: NetworkPickerProps) {
    const { grids, selected, selectedGrid, selectGrid, refresh } = useNetwork();

    return (
        <div className={cx("network-picker", `network-picker--${variant}`, className)}>
            <label className={cx("network-picker__label", variant === "topbar" && "sr-only")} htmlFor="network-select">
                Network
            </label>
            <select
                id="network-select"
                className="network-picker__select"
                value={String(selected)}
                onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    const next: GridSelection = value === "all" ? "all" : Number(value);
                    selectGrid(next);
                }}
            >
                <option value="all">All Grids</option>
                {grids.map((g) => (
                    <option key={g.key} value={g.key} disabled={g.key === -1}>
                        {gridOptionLabel(g, grids)}
                    </option>
                ))}
            </select>
            <span className="network-picker__meta">{gridMetaLine(selected, grids, selectedGrid)}</span>
            {selectedGrid && selectedGrid.key !== -1 && (
                <GridTrackingCheckbox grid={selectedGrid} onTracked={refresh} />
            )}
        </div>
    );
}
