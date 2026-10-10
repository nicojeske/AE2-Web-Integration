// The stock-rule fields of one item (Favorites rows, the Browser's item panel). Edits go straight to the
// server's per-grid rule (`state/stockRules.tsx`) - every player with access to the grid shares it.
import { useState } from "preact/hooks";

import { formatDuration, formatNumber } from "../api/format";
import type { GridKey, StockRule, StockRuleInput } from "../api/types";
import { DEFAULT_STOCK_RULE, useStockRules } from "../state/stockRules";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";

interface StockRuleEditorProps {
    gridKey: GridKey;
    itemid: string;
    rule: StockRule | null;
    /** The live stored amount (the Browser's), which decides the Low badge. */
    stored: number;
    numberFormat: "full" | "compact";
}

/** Sanitizes a number input's raw value: whole, at least `min`, falling back to `fallback` when unparsable
 *  (an emptied field, a stray minus sign mid-edit) rather than sending `NaN`. */
function parseRuleInput(raw: string, min: number, fallback: number): number {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

function inputOf(rule: StockRule): StockRuleInput {
    return {
        alertBelow: rule.alertBelow,
        keepStock: rule.keepStock,
        batchSize: rule.batchSize,
        autoCraft: rule.autoCraft,
    };
}

export function StockRuleEditor({ gridKey, itemid, rule, stored, numberFormat }: StockRuleEditorProps) {
    const { setRule, removeRule } = useStockRules();

    if (!rule) {
        return (
            <Button
                variant="secondary"
                size="sm"
                title="Alert below a level and keep it stocked - checked by the server, shared with this network's players"
                onClick={() => void setRule(gridKey, itemid, DEFAULT_STOCK_RULE)}
            >
                Add stock rule
            </Button>
        );
    }

    const update = (field: keyof StockRuleInput, value: number | boolean) => {
        if (rule[field] === value) return;
        void setRule(gridKey, itemid, { ...inputOf(rule), [field]: value });
    };
    const low = stored < rule.alertBelow;

    return (
        <div className="stock-rule">
            <div className="stock-rule__fields">
                <NumberField
                    label="Alert below"
                    value={rule.alertBelow}
                    min={0}
                    onChange={(n) => update("alertBelow", n)}
                />
                <NumberField
                    label="Keep stock at"
                    value={rule.keepStock}
                    min={0}
                    onChange={(n) => update("keepStock", n)}
                />
                <NumberField
                    label="Batch size"
                    value={rule.batchSize}
                    min={1}
                    onChange={(n) => update("batchSize", n)}
                />
                <Checkbox checked={rule.autoCraft} onChange={(checked) => update("autoCraft", checked)}>
                    <span className="stock-rule__autocraft-label">Auto-craft</span>
                </Checkbox>
                <Badge variant={low ? "red" : "green"} size="sm">
                    {low ? "Low stock" : "OK"}
                </Badge>
                {rule.crafting && (
                    <Badge variant="teal" size="sm">
                        Crafting
                    </Badge>
                )}
                <button
                    type="button"
                    className="stock-rule__remove"
                    title="Delete this stock rule"
                    onClick={() => void removeRule(gridKey, itemid)}
                >
                    Remove rule
                </button>
            </div>
            <StockRuleStatus rule={rule} numberFormat={numberFormat} />
        </div>
    );
}

function StockRuleStatus({ rule, numberFormat }: { rule: StockRule; numberFormat: "full" | "compact" }) {
    if (rule.stored < 0) return <p className="stock-rule__status">Not checked by the server yet</p>;
    const now = Date.now();
    const parts = [`Server saw ${formatNumber(rule.stored, numberFormat)}`];
    if (rule.autoCraft && rule.lastError) {
        const retry = rule.backoffUntil > now ? ` - retrying in ${formatDuration(rule.backoffUntil - now)}` : "";
        return (
            <p className="stock-rule__status stock-rule__status--error">
                {parts[0]} · Auto-craft: {rule.lastError}
                {retry}
            </p>
        );
    }
    if (rule.lastAttempt > 0) parts.push(`last auto-craft ${formatDuration(now - rule.lastAttempt)} ago`);
    return <p className="stock-rule__status">{parts.join(" · ")}</p>;
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
        onChange(parseRuleInput(draft, min, value));
        setDraft(null);
    };

    return (
        <label className="stock-rule__field">
            <span className="stock-rule__field-label">{label}</span>
            <input
                type="number"
                min={min}
                className="stock-rule__field-input"
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
