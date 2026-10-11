// The network chip in the topbar: the selected grid (or All Grids), opening a list of the player's grids
// with the selected grid's tracking switch underneath.
import { useEffect, useState } from "preact/hooks";

import { ApiError, setGridTracking } from "../api/client";
import type { GridSummary } from "../api/types";
import { useNetwork } from "../state/network";
import type { GridSelection } from "../state/network";
import { useToast } from "../state/toast";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { usePopover } from "../ui/usePopover";
import { gridMetaLine, gridOptionLabel } from "./gridLabel";

/**
 * `gridsettings?track=` is the only way to switch tracking on anywhere in the mod, and tracking gates
 * craft progress, the time-spent figures and the whole Crafting History section.
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
            Track crafting on this network
        </Checkbox>
    );
}

interface MenuRow {
    key: GridSelection;
    name: string;
    meta: string;
}

function menuRows(grids: GridSummary[]): MenuRow[] {
    return [
        { key: "all", name: "All Grids", meta: gridMetaLine("all", grids, null) },
        ...grids.map((g) => ({
            key: g.key,
            name: gridOptionLabel(g, grids),
            meta: `${g.cpuCount} CPU${g.cpuCount === 1 ? "" : "s"}${g.isTrackingEnabled ? " · tracked" : ""}`,
        })),
    ];
}

export function NetworkMenu({ disabled }: { disabled?: boolean }) {
    const { grids, selected, selectedGrid, selectGrid, refresh } = useNetwork();
    const { open, setOpen, ref } = usePopover();
    const label = selected === "all" ? "All Grids" : selectedGrid ? gridOptionLabel(selectedGrid, grids) : "No network";

    return (
        <div className="network-menu" ref={ref}>
            <button
                type="button"
                className="network-menu__chip"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                title={
                    disabled
                        ? "The GregTech pages aren't tied to a network"
                        : gridMetaLine(selected, grids, selectedGrid)
                }
                onClick={() => setOpen((o) => !o)}
            >
                <span
                    className="dot"
                    style={{ background: selectedGrid || selected === "all" ? "var(--green)" : "var(--text-dim)" }}
                />
                <span className="network-menu__label">{label}</span>
                <span className="chip__caret">▾</span>
            </button>
            {open && (
                <div className="network-menu__panel" role="menu">
                    <span className="section-label">Network</span>
                    <div className="network-menu__list">
                        {menuRows(grids).map((row) => (
                            <button
                                key={row.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={row.key === selected}
                                className={cx(
                                    "network-menu__option",
                                    row.key === selected && "network-menu__option--active",
                                )}
                                onClick={() => {
                                    selectGrid(row.key);
                                    setOpen(false);
                                }}
                            >
                                <span>{row.name}</span>
                                <span className="network-menu__meta">{row.meta}</span>
                            </button>
                        ))}
                    </div>
                    {selectedGrid && (
                        <div className="network-menu__tracking">
                            <GridTrackingCheckbox grid={selectedGrid} onTracked={refresh} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
