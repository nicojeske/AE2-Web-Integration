// Pinned Items modal. Rows are the grid's loaded items plus every pinned id no longer present in them
// (so a departed item can still be unpinned). Every item's history is recorded server-side either way;
// pinning only picks which ones get a card.
import { useMemo, useState } from "preact/hooks";

import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { MAX_PINNED, useStats } from "../state/stats";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { Modal } from "../ui/Modal";
import { buildPinnableRows, type PinnableSource } from "./statsModel";

export interface ManagePinnedModalProps {
    onClose: () => void;
}

export function ManagePinnedModal({ onClose }: ManagePinnedModalProps) {
    const { selectedGrid } = useNetwork();
    const { items } = useItems();
    const { pinned, names, pin, unpin } = useStats();
    const [search, setSearch] = useState("");

    const gridKey = selectedGrid?.key ?? null;

    const { sources, rawNames } = useMemo(() => {
        const byId = new Map<string, PinnableSource>();
        const formatted = new Map<string, string>();
        for (const item of items) {
            if (item.sourceGridKey !== gridKey) continue;
            byId.set(item.itemid, { itemid: item.itemid, name: item.plainName, quantity: item.quantity });
            formatted.set(item.itemid, item.itemname);
        }
        for (const id of pinned) {
            if (!byId.has(id)) {
                const remembered = names[id];
                byId.set(id, { itemid: id, name: remembered ?? id, quantity: null });
                if (remembered) formatted.set(id, remembered);
            }
        }
        return { sources: [...byId.values()], rawNames: formatted };
    }, [items, gridKey, pinned, names]);

    const rows = buildPinnableRows(sources, pinned, search);
    const atCap = pinned.length >= MAX_PINNED;

    return (
        <Modal
            onClose={onClose}
            width={420}
            title="Pinned items"
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
                {pinned.length} / {MAX_PINNED} pinned
            </div>
            <p className="tracked__note">Every item&apos;s history is recorded; pinning picks which get a card.</p>
            <div className="tracked__list">
                {rows.map((row) => (
                    <div key={row.itemid} className="tracked__row-wrap">
                        <Checkbox
                            className="tracked__row"
                            checked={row.pinned}
                            disabled={!row.pinned && atCap}
                            title={!row.pinned && atCap ? "Limit reached - unpin something first" : undefined}
                            onChange={(checked) => (checked ? pin(row.itemid) : unpin(row.itemid))}
                        >
                            <ItemIcon itemid={row.itemid} name={rawNames.get(row.itemid) ?? row.name} size={20} />
                            <FormattedText text={rawNames.get(row.itemid) ?? row.name} className="tracked__row-name" />
                            {row.quantity === null && <span className="tracked__row-missing">not on this network</span>}
                        </Checkbox>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
