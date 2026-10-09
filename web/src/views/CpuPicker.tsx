import type { GridKey } from "../api/types";
import { useCpus } from "../state/cpus";
import { cpuRows } from "./orderModel";

export interface CpuPickerProps {
    gridKey: GridKey;
    /** The plan's output - a busy CPU crafting the same item can take the plan as a merge. */
    itemid: string;
    bytesTotal: number;
    selectedCpu: string | null;
    onSelect: (cpuKey: string) => void;
}

/** The grid's crafting CPUs for a computed plan, best first, unusable ones disabled with the reason. */
export function CpuPicker({ gridKey, itemid, bytesTotal, selectedCpu, onSelect }: CpuPickerProps) {
    const { cpus } = useCpus();
    const rows = cpuRows(
        cpus.filter((c) => c.sourceGridKey === gridKey),
        bytesTotal,
        itemid,
        selectedCpu,
    );

    if (rows.length === 0) return <p className="order-modal__notice">This network has no crafting CPUs.</p>;

    return (
        <div className="order-modal__cpu-list">
            {rows.map((row) => (
                <button
                    key={row.cpuKey}
                    type="button"
                    className={`order-modal__cpu-row order-modal__cpu-row--${row.state}${
                        row.selected ? " order-modal__cpu-row--selected" : ""
                    }`}
                    disabled={!row.selectable}
                    onClick={() => onSelect(row.cpuKey)}
                >
                    <span className="order-modal__cpu-row-head">
                        <span>{row.name}</span>
                        <span className="order-modal__cpu-tag">{row.tag}</span>
                    </span>
                    <span className="order-modal__cpu-row-detail">{row.detail}</span>
                </button>
            ))}
        </div>
    );
}
