import { useMemo } from "preact/hooks";

import { formatNumber } from "../api/format";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { DEFAULT_THRESHOLDS, prefsKey, usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { StarIcon } from "../ui/icons";
import { filterItems, ITEMS_TYPE, SORT_BY, sortItems, STORED_CRAFTABLE } from "./browserModel";
import type { BrowserItem } from "../state/items";

export interface BrowserProps {
    search: string;
}

export function Browser({ search }: BrowserProps) {
    const { items, loading, error, failedGrids, refresh } = useItems();
    const { selected, selectedGrid } = useNetwork();
    const { thresholds, isFavorite, toggleFavorite, browserFilters, setBrowserFilters } = usePrefs();
    const { startOrder } = useOrder();

    const isAllGrids = selected === "all";
    const hasFluids = useMemo(() => items.some((it) => it.isFluid), [items]);
    const { storedCraftable, itemsType, sortBy, sortOrder } = browserFilters;

    const filtered = useMemo(() => {
        // When the fluids pill is hidden (this grid has none), don't let a persisted "Fluids only"
        // silently empty the list - fall back to "Items & fluids" for the actual filtering pass.
        const effectiveItemsType = hasFluids ? itemsType : 2;
        const rows = filterItems(items, { storedCraftable, itemsType: effectiveItemsType, search });
        return sortItems(rows, sortBy, sortOrder, isFavorite);
    }, [items, storedCraftable, itemsType, hasFluids, search, sortBy, sortOrder, isFavorite]);

    const cycleStoredCraftable = () =>
        setBrowserFilters((s) => ({ ...s, storedCraftable: ((s.storedCraftable + 1) % 3) as 0 | 1 | 2 }));
    const cycleItemsType = () => setBrowserFilters((s) => ({ ...s, itemsType: ((s.itemsType + 1) % 3) as 0 | 1 | 2 }));
    const cycleSortBy = () => setBrowserFilters((s) => ({ ...s, sortBy: ((s.sortBy + 1) % 3) as 0 | 1 | 2 }));
    const cycleSortOrder = () => setBrowserFilters((s) => ({ ...s, sortOrder: s.sortOrder === 0 ? 1 : 0 }));

    const onCraft = (item: BrowserItem) => {
        startOrder({
            sourceGridId: item.sourceGridId,
            gridLabel: item.gridLabel,
            itemid: item.itemid,
            itemname: item.itemname,
        });
    };

    if (selected !== "all" && (!selectedGrid || selectedGrid.key === -1)) {
        return <div className="placeholder-panel">No network selected.</div>;
    }

    if (loading && items.length === 0) {
        return <div className="placeholder-panel">Loading items…</div>;
    }

    if (error) {
        return (
            <div className="placeholder-panel browser__error">
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void refresh()}>
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <>
            <section className="browser__toolbar">
                <Button variant="pill" onClick={cycleStoredCraftable}>
                    {STORED_CRAFTABLE[storedCraftable]}
                </Button>
                {hasFluids && (
                    <Button variant="pill" onClick={cycleItemsType}>
                        {ITEMS_TYPE[itemsType]}
                    </Button>
                )}
                <Button variant="pill" onClick={cycleSortBy}>
                    Sort: {SORT_BY[sortBy]}
                </Button>
                <Button variant="pill" onClick={cycleSortOrder}>
                    {sortOrder === 0 ? "Ascending" : "Descending"}
                </Button>
                <span className="browser__count">
                    {filtered.length} of {items.length} shown
                </span>
            </section>

            {isAllGrids && failedGrids.length > 0 && (
                <p className="browser__warning">{`Couldn't load items from: ${failedGrids.join(", ")}`}</p>
            )}

            {filtered.length === 0 ? (
                <div className="placeholder-panel">No items match the current filters.</div>
            ) : (
                <section className="item-grid">
                    {filtered.map((item) => {
                        const key = prefsKey(item.sourceGridId, item.itemid);
                        const favorited = isFavorite(key);
                        const alertBelow = thresholds[key]?.alertBelow ?? DEFAULT_THRESHOLDS.alertBelow;
                        const lowStock = favorited && item.quantity < alertBelow;
                        return (
                            <Card key={`${item.sourceGridId}:${item.itemid}`} className="item-card">
                                <button
                                    type="button"
                                    className="item-card__star"
                                    title="Favorite"
                                    aria-pressed={favorited}
                                    style={{ color: favorited ? "var(--amber)" : "var(--star-inactive)" }}
                                    onClick={() => toggleFavorite(item.sourceGridId, item.itemid)}
                                >
                                    <StarIcon size={16} />
                                </button>
                                <div className="item-card__head">
                                    <ItemIcon itemid={item.itemid} name={item.itemname} size={44} />
                                    <div className="item-card__title">
                                        <FormattedText text={item.itemname} className="item-card__name" />
                                        <span className="item-card__mod">
                                            {item.mod}
                                            {isAllGrids ? ` - ${item.gridLabel}` : ""}
                                        </span>
                                    </div>
                                </div>
                                <div className="item-card__stored">
                                    <span className="item-card__stored-value">{formatNumber(item.quantity)}</span>
                                    <span className="item-card__stored-label">stored</span>
                                </div>
                                <div className="item-card__badges">
                                    {lowStock && (
                                        <Badge variant="red" size="sm">
                                            Low stock
                                        </Badge>
                                    )}
                                    {item.craftable ? (
                                        <>
                                            <Badge variant="teal" size="sm">
                                                Craftable
                                            </Badge>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                className="item-card__craft"
                                                onClick={() => onCraft(item)}
                                            >
                                                Craft
                                            </Button>
                                        </>
                                    ) : (
                                        <span className="item-card__not-craftable">Not craftable</span>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </section>
            )}
        </>
    );
}
