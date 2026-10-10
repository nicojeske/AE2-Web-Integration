import { useMemo } from "preact/hooks";

import { formatNumber } from "../api/format";
import type { GridKey, StockRule } from "../api/types";
import { useItems } from "../state/items";
import { useOrder } from "../state/order";
import { prefsKey, usePrefs } from "../state/prefs";
import { useStockRules } from "../state/stockRules";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import { StarIcon } from "../ui/icons";
import { StockRuleEditor } from "./StockRuleEditor";

interface FavoriteRow {
    key: string;
    gridKey: GridKey;
    gridLabel: string;
    itemid: string;
    itemname: string;
    stored: number;
    favorite: boolean;
    rule: StockRule | null;
}

/**
 * The player's favourites, plus every item with a stock rule on the loaded grids - rules are shared per grid,
 * so one another player set shows here too, since it orders crafts on this network.
 */
export function Favorites() {
    const { items } = useItems();
    const { favorites, toggleFavorite, settings } = usePrefs();
    const { rules } = useStockRules();
    const { startOrder } = useOrder();

    const listed = useMemo(() => new Set([...Object.keys(favorites), ...Object.keys(rules)]), [favorites, rules]);

    const rows = useMemo<FavoriteRow[]>(() => {
        const out: FavoriteRow[] = [];
        for (const item of items) {
            const key = prefsKey(item.sourceGridKey, item.itemid);
            if (!listed.has(key)) continue;
            out.push({
                key,
                gridKey: item.sourceGridKey,
                gridLabel: item.gridLabel,
                itemid: item.itemid,
                itemname: item.itemname,
                stored: item.quantity,
                favorite: favorites[key] === true,
                rule: rules[key] ?? null,
            });
        }
        // Favourites first, then the other stocked items, each in the Browser's order.
        return out.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }, [items, listed, favorites, rules]);

    // Entries whose grid isn't part of the currently loaded `items` (a different single grid is selected,
    // or the network went away) can't be resolved into a row at all - counted so the pane can say why the
    // list looks short instead of silently dropping them.
    const unresolvedCount = Object.keys(favorites).filter((key) => !rows.some((r) => r.key === key)).length;

    if (rows.length === 0 && unresolvedCount === 0) {
        return (
            <div className="placeholder-panel">
                No favorites yet. Star items in the Item Browser to track them here.
            </div>
        );
    }

    return (
        <section className="favorites-list">
            {rows.map((row) => (
                <Card key={row.key} className="favorite-row">
                    <button
                        type="button"
                        className="favorite-row__star"
                        title={row.favorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={row.favorite}
                        style={{ color: row.favorite ? "var(--amber)" : "var(--star-inactive)" }}
                        onClick={() => toggleFavorite(row.gridKey, row.itemid)}
                    >
                        <StarIcon size={14} />
                    </button>
                    <div className="favorite-row__identity">
                        <FormattedText text={row.itemname} className="favorite-row__name" />
                        <span className="favorite-row__meta">
                            {row.gridLabel} - {formatNumber(row.stored, settings.numberFormat)} stored
                        </span>
                    </div>

                    <StockRuleEditor
                        gridKey={row.gridKey}
                        itemid={row.itemid}
                        rule={row.rule}
                        stored={row.stored}
                        numberFormat={settings.numberFormat}
                    />

                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                            startOrder({
                                sourceGridKey: row.gridKey,
                                itemid: row.itemid,
                                itemname: row.itemname,
                            })
                        }
                    >
                        Craft
                    </Button>
                </Card>
            ))}
            {unresolvedCount > 0 && (
                <p className="favorites-list__footnote">
                    {unresolvedCount} favorite{unresolvedCount === 1 ? "" : "s"} on other networks - switch to All Grids
                    to see them.
                </p>
            )}
        </section>
    );
}
