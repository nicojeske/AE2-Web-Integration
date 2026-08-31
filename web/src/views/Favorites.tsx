import { useMemo, useState } from "preact/hooks";

import { formatNumber } from "../api/format";
import { useItems } from "../state/items";
import { useOrder } from "../state/order";
import { DEFAULT_THRESHOLDS, prefsKey, usePrefs } from "../state/prefs";
import type { Thresholds } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { FormattedText } from "../ui/FormattedText";
import { isLowStock } from "./browserModel";

interface FavoriteRow {
    key: string;
    gridId: number;
    gridLabel: string;
    itemid: string;
    itemname: string;
    stored: number;
    thresholds: Thresholds;
    lowStock: boolean;
}

/** Sanitizes a number input's raw value: whole, non-negative, falling back to `fallback` when unparsable
 *  (an emptied field, a stray minus sign mid-edit) rather than writing `NaN` into prefs. */
function parseThresholdInput(raw: string, min: number, fallback: number): number {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export function Favorites() {
    const { items } = useItems();
    const { favorites, thresholds, setThreshold, removeFavorite } = usePrefs();
    const { startOrder } = useOrder();

    const rows = useMemo<FavoriteRow[]>(() => {
        const byKey = new Map(items.map((item) => [prefsKey(item.sourceGridId, item.itemid), item]));
        return Object.keys(favorites)
            .map((key) => byKey.get(key))
            .filter((item): item is NonNullable<typeof item> => item != null)
            .map((item) => {
                const key = prefsKey(item.sourceGridId, item.itemid);
                return {
                    key,
                    gridId: item.sourceGridId,
                    gridLabel: item.gridLabel,
                    itemid: item.itemid,
                    itemname: item.itemname,
                    stored: item.quantity,
                    thresholds: thresholds[key] ?? DEFAULT_THRESHOLDS,
                    lowStock: isLowStock(item, favorites, thresholds),
                };
            });
    }, [items, favorites, thresholds]);

    // Favourites whose grid isn't part of the currently loaded `items` (a different single grid is
    // selected, or the network went away) can't be resolved into a row at all - counted so the pane can
    // say why the list looks short instead of silently dropping them (unlike the design prototype, which
    // drops unresolved favourites with no explanation).
    const unresolvedCount = Object.keys(favorites).length - rows.length;

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
                <FavoriteRowCard
                    key={row.key}
                    row={row}
                    onThresholdChange={(field, value) => setThreshold(row.key, field, value)}
                    onCraft={() =>
                        startOrder({
                            sourceGridId: row.gridId,
                            gridLabel: row.gridLabel,
                            itemid: row.itemid,
                            itemname: row.itemname,
                        })
                    }
                    onRemove={() => removeFavorite(row.key)}
                />
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

interface FavoriteRowCardProps {
    row: FavoriteRow;
    onThresholdChange: (field: keyof Thresholds, value: number | boolean) => void;
    onCraft: () => void;
    onRemove: () => void;
}

function FavoriteRowCard({ row, onThresholdChange, onCraft, onRemove }: FavoriteRowCardProps) {
    return (
        <Card className="favorite-row">
            <div className="favorite-row__identity">
                <FormattedText text={row.itemname} className="favorite-row__name" />
                <span className="favorite-row__meta">
                    {row.gridLabel} - {formatNumber(row.stored)} stored
                </span>
            </div>

            <NumberField
                label="Alert below"
                value={row.thresholds.alertBelow}
                min={0}
                onChange={(n) => onThresholdChange("alertBelow", n)}
            />
            <NumberField
                label="Keep stock at"
                value={row.thresholds.keepStock}
                min={0}
                onChange={(n) => onThresholdChange("keepStock", n)}
            />
            <NumberField
                label="Batch size"
                value={row.thresholds.batchSize}
                min={1}
                onChange={(n) => onThresholdChange("batchSize", n)}
            />

            <Checkbox
                checked={row.thresholds.autoCraft}
                onChange={(checked) => onThresholdChange("autoCraft", checked)}
            >
                <span className="favorite-row__autocraft-label">Auto-craft</span>
            </Checkbox>

            <Badge variant={row.lowStock ? "red" : "green"} size="sm">
                {row.lowStock ? "Low stock" : "OK"}
            </Badge>

            <Button variant="primary" size="sm" onClick={onCraft}>
                Craft
            </Button>

            <button type="button" className="favorite-row__remove" title="Remove from favorites" onClick={onRemove}>
                ×
            </button>
        </Card>
    );
}

interface NumberFieldProps {
    label: string;
    value: number;
    min: number;
    onChange: (value: number) => void;
}

function NumberField({ label, value, min, onChange }: NumberFieldProps) {
    // Local draft state so the field can be emptied mid-edit without immediately snapping back to a
    // sanitized value on every keystroke; committed (and sanitized) on blur/Enter.
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) return;
        onChange(parseThresholdInput(draft, min, value));
        setDraft(null);
    };

    return (
        <label className="favorite-row__field">
            <span className="favorite-row__field-label">{label}</span>
            <input
                type="number"
                min={min}
                className="favorite-row__field-input"
                value={draft ?? value}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
            />
        </label>
    );
}
