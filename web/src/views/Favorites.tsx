import { useMemo, useState } from "preact/hooks";

import { formatNumber } from "../api/format";
import type { GridKey, StockRule, StockRuleInput } from "../api/types";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { prefsKey, usePrefs } from "../state/prefs";
import { DEFAULT_STOCK_RULE, useStockRules } from "../state/stockRules";
import { Button } from "../ui/Button";
import { ToggleChip } from "../ui/ChipMenu";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { StarIcon } from "../ui/icons";
import { inputOf, RuleNumberInput } from "./StockRuleEditor";

interface FavoriteRow {
    key: string;
    gridKey: GridKey;
    gridLabel: string;
    itemid: string;
    itemname: string;
    stored: number;
    craftable: boolean;
    orderable: boolean;
    favorite: boolean;
    rule: StockRule | null;
}

/** 0 below the alert level, 1 below the keep-stock target, 2 fine or without a rule. */
function urgency(row: FavoriteRow): number {
    if (!row.rule) return 2;
    if (row.stored < row.rule.alertBelow) return 0;
    return row.stored < row.rule.keepStock ? 1 : 2;
}

const URGENCY_COLORS = ["var(--red)", "var(--amber)", "var(--cyan)"];

export interface FavoritesProps {
    /** The Item Browser with this item in its inspector. */
    onOpenItem: (itemid: string) => void;
}

/**
 * The player's favourites, plus every item with a stock rule on the loaded grids - rules are shared per grid,
 * so one another player set shows here too, since it orders crafts on this network.
 */
export function Favorites({ onOpenItem }: FavoritesProps) {
    const { items } = useItems();
    const { selected } = useNetwork();
    const { favorites, toggleFavorite, settings } = usePrefs();
    const { rules, setRule } = useStockRules();
    const { startOrder } = useOrder();
    const [belowFirst, setBelowFirst] = useState(true);

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
                craftable: item.craftable,
                orderable: item.craftable && item.itemKey !== null,
                favorite: favorites[key] === true,
                rule: rules[key] ?? null,
            });
        }
        // Favourites first, then the other stocked items, each in the Browser's order - or, with
        // "Below rule first", whatever needs crafting at the top.
        return out.sort(
            (a, b) => (belowFirst ? urgency(a) - urgency(b) : 0) || Number(b.favorite) - Number(a.favorite),
        );
    }, [items, listed, favorites, rules, belowFirst]);

    // Entries whose grid isn't part of the currently loaded `items` can't be resolved into a row at all -
    // counted so the pane can say why the list looks short instead of silently dropping them.
    const unresolvedCount = Object.keys(favorites).filter((key) => !rows.some((r) => r.key === key)).length;

    const editRule = (row: FavoriteRow, field: "keepStock" | "alertBelow", value: number) => {
        const base: StockRuleInput = row.rule ? inputOf(row.rule) : DEFAULT_STOCK_RULE;
        void setRule(row.gridKey, row.itemid, { ...base, [field]: value });
    };

    return (
        <div className="page">
            <div className="page__main">
                <header className="page-header">
                    <h2 className="page-header__title">Favorites</h2>
                    <span className="page-header__sub">
                        Starred items and every item with a stock rule on this network
                    </span>
                    <div className="page-header__end">
                        <ToggleChip active={belowFirst} onChange={setBelowFirst}>
                            Below rule first
                        </ToggleChip>
                    </div>
                </header>
                <div className="page__scroll">
                    {rows.length === 0 ? (
                        <div className="placeholder-panel">
                            No favorites yet. Star items in the Item Browser to track them here.
                        </div>
                    ) : (
                        <div className="dtable fav-table">
                            <div className="dtable__head">
                                <span />
                                <span />
                                <span>Item</span>
                                <span>Stored vs. rule</span>
                                <span>Keep at least</span>
                                <span>Alert below</span>
                                <span />
                            </div>
                            {rows.map((row) => {
                                const level = urgency(row);
                                const target = row.rule ? Math.max(row.rule.keepStock, row.rule.alertBelow) : 0;
                                const max = target > 0 ? target * 1.25 : Math.max(1, row.stored);
                                return (
                                    <div key={row.key} className="dtable__row fav-row">
                                        <button
                                            type="button"
                                            className="item-row__star"
                                            title={row.favorite ? "Remove from favorites" : "Add to favorites"}
                                            aria-pressed={row.favorite}
                                            style={{ color: row.favorite ? "var(--amber)" : "var(--star-inactive)" }}
                                            onClick={() => toggleFavorite(row.gridKey, row.itemid)}
                                        >
                                            <StarIcon size={14} />
                                        </button>
                                        <ItemIcon itemid={row.itemid} name={row.itemname} size={26} />
                                        <button
                                            type="button"
                                            className="cell-stack fav-row__identity"
                                            title="Stock, history and stock rule"
                                            onClick={() => onOpenItem(row.itemid)}
                                        >
                                            <FormattedText text={row.itemname} className="cell-text" />
                                            <span className="cell-sub">
                                                {row.gridLabel} · {row.favorite ? "starred" : "stock rule only"}
                                            </span>
                                        </button>
                                        <div className="fav-row__level">
                                            <div className="bar">
                                                <div
                                                    className="bar__fill"
                                                    style={{
                                                        width: `${Math.min(100, (row.stored / max) * 100)}%`,
                                                        background: URGENCY_COLORS[level],
                                                    }}
                                                />
                                                {row.rule && (
                                                    <span
                                                        className="bar__marker"
                                                        style={{
                                                            left: `${Math.min(100, (row.rule.alertBelow / max) * 100)}%`,
                                                            background: "var(--red)",
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            <span
                                                className="fav-row__stored"
                                                style={{ color: level < 2 ? URGENCY_COLORS[level] : undefined }}
                                            >
                                                {formatNumber(row.stored, settings.numberFormat)}
                                            </span>
                                        </div>
                                        <RuleNumberInput
                                            label="Keep at least"
                                            value={row.rule?.keepStock ?? null}
                                            min={0}
                                            placeholder="No rule"
                                            onCommit={(n) => editRule(row, "keepStock", n)}
                                        />
                                        <RuleNumberInput
                                            label="Alert below"
                                            value={row.rule?.alertBelow ?? null}
                                            min={0}
                                            placeholder="—"
                                            onCommit={(n) => editRule(row, "alertBelow", n)}
                                        />
                                        {row.craftable ? (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                disabled={!row.orderable}
                                                onClick={() =>
                                                    startOrder({
                                                        sourceGridKey: row.gridKey,
                                                        itemid: row.itemid,
                                                        itemname: row.itemname,
                                                        quantity:
                                                            row.rule && row.rule.keepStock > row.stored
                                                                ? row.rule.keepStock - row.stored
                                                                : undefined,
                                                    })
                                                }
                                            >
                                                Craft
                                            </Button>
                                        ) : (
                                            <span />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {unresolvedCount > 0 && selected !== "all" && (
                        <p className="fav-footnote">
                            {unresolvedCount} favorite{unresolvedCount === 1 ? "" : "s"} on other networks. Switch to
                            All Grids to see them.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
