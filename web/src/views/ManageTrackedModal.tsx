// Manage Tracked Items modal (M8). Rows are the grid's loaded items plus every tracked id no longer
// present in them (so a departed item can still be untracked) - see REDESIGN_MILESTONES.md's M8 plan.
import { useMemo, useState } from "preact/hooks";

import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useStats } from "../state/stats";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { FormattedText } from "../ui/FormattedText";
import { Modal } from "../ui/Modal";
import { buildTrackableRows, type TrackableSource } from "./statsModel";

export interface ManageTrackedModalProps {
    onClose: () => void;
}

export function ManageTrackedModal({ onClose }: ManageTrackedModalProps) {
    const { selectedGrid } = useNetwork();
    const { items } = useItems();
    const { tracked, trackedLimit, addTracked, removeTracked } = useStats();
    const [search, setSearch] = useState("");
    const [confirming, setConfirming] = useState<string | null>(null);

    const gridId = selectedGrid?.key ?? null;

    const { sources, rawNames } = useMemo(() => {
        const byId = new Map<string, TrackableSource>();
        const names = new Map<string, string>();
        for (const item of items) {
            if (item.sourceGridId !== gridId) continue;
            byId.set(item.itemid, { itemid: item.itemid, name: item.plainName, quantity: item.quantity });
            names.set(item.itemid, item.itemname);
        }
        for (const id of tracked) {
            if (!byId.has(id)) byId.set(id, { itemid: id, name: id, quantity: null });
        }
        return { sources: [...byId.values()], rawNames: names };
    }, [items, gridId, tracked]);

    const rows = buildTrackableRows(sources, tracked, search);
    const atCap = tracked.length >= trackedLimit;

    return (
        <Modal
            onClose={onClose}
            width={420}
            title="Tracked items"
            footer={
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            }
        >
            <div className="tracked__search">
                <input
                    type="text"
                    placeholder="Search items and fluids…"
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
            </div>
            <div className={`tracked__count${atCap ? " tracked__count--full" : ""}`}>
                {tracked.length} / {trackedLimit} tracked
            </div>
            <p className="tracked__note">Untracking an item deletes its recorded history.</p>
            <div className="tracked__list">
                {rows.map((row) => (
                    <div key={row.itemid} className="tracked__row-wrap">
                        <Checkbox
                            className="tracked__row"
                            checked={row.tracked}
                            disabled={!row.tracked && atCap}
                            title={!row.tracked && atCap ? "Limit reached - untrack something first" : undefined}
                            onChange={(checked) => {
                                if (checked) {
                                    void addTracked(row.itemid);
                                } else {
                                    setConfirming(row.itemid);
                                }
                            }}
                        >
                            <FormattedText text={rawNames.get(row.itemid) ?? row.name} className="tracked__row-name" />
                            {row.quantity === null && <span className="tracked__row-missing">not on this network</span>}
                        </Checkbox>
                        {confirming === row.itemid && (
                            <div className="tracked__confirm">
                                <span>Untracking deletes this item&apos;s recorded history.</span>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => {
                                        void removeTracked(row.itemid);
                                        setConfirming(null);
                                    }}
                                >
                                    Untrack
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                                    Cancel
                                </Button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Modal>
    );
}
