// Opens the Browser's item panel (ItemDetail.tsx) for an item a crafting job mentions - a column row or a
// consumed input on Craft Detail or a history entry. The panel wants a Browser row; the items poll has it
// when the job's grid is the one loaded, otherwise (or when nothing is stored) a stand-in is built.
import type { GridKey, ResourceRef } from "../api/types";
import { skipSpecialFormat } from "../api/format";
import { buildHash } from "../shell/route";
import type { BrowserItem } from "../state/items";
import { useItems } from "../state/items";
import { useOrder } from "../state/order";
import { isFluidId, modOf } from "./browserModel";
import { ItemDetail } from "./ItemDetail";

export function JobItemDetail({
    gridKey,
    item: ref,
    onClose,
}: {
    gridKey: GridKey;
    item: ResourceRef;
    onClose: () => void;
}) {
    const { items } = useItems();
    const { startOrder } = useOrder();
    const item: BrowserItem = items.find((it) => it.sourceGridKey === gridKey && it.itemid === ref.itemid) ?? {
        itemKey: null,
        identityStatus: null,
        itemid: ref.itemid,
        itemname: ref.itemname,
        quantity: 0,
        craftable: false,
        sourceGridKey: gridKey,
        gridLabel: "",
        mod: modOf(ref.itemid),
        isFluid: isFluidId(ref.itemid),
        plainName: skipSpecialFormat(ref.itemname),
    };
    return (
        <ItemDetail
            item={item}
            onClose={onClose}
            onCraft={(it) => {
                onClose();
                startOrder({ sourceGridKey: it.sourceGridKey, itemid: it.itemid, itemname: it.itemname });
            }}
            onOpenHistory={(itemid) => {
                location.hash = buildHash({ section: "history", grid: gridKey, detail: null, item: itemid });
            }}
            onOpenCraft={({ gridKey: grid, id }) => {
                location.hash = buildHash({
                    section: "history",
                    grid,
                    detail: { type: "history", gridKey: grid, id },
                    item: null,
                });
            }}
        />
    );
}
