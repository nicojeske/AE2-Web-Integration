// The Statistics KPI strip: pinned count, items below their alert level, and the range's biggest gain and
// drop - all computed from the `history` bundle `state/stats.tsx` already polls; no extra requests.
import type { GridKey, StatsRange, StockRule } from "../api/types";
import { formatNumber, skipSpecialFormat } from "../api/format";
import { MAX_PINNED, type HistoryBundle } from "../state/stats";
import type { BrowserItem } from "../state/items";
import { isLowStock } from "./browserModel";
import { RANGE_OPTIONS, seriesStats } from "./statsModel";

export interface StatsOverviewProps {
    gridKey: GridKey;
    pinned: string[];
    items: BrowserItem[];
    /** Last-seen names of pinned items that left storage. */
    names: Record<string, string>;
    stockRules: Record<string, StockRule>;
    history: HistoryBundle | null;
    range: StatsRange;
    numberFormat: "full" | "compact";
}

export function StatsOverview({
    gridKey,
    pinned,
    items,
    names,
    stockRules,
    history,
    range,
    numberFormat,
}: StatsOverviewProps) {
    const stepMillis = history?.stepMillis ?? 0;
    const nameOf = (id: string) =>
        skipSpecialFormat(
            items.find((it) => it.sourceGridKey === gridKey && it.itemid === id)?.itemname ?? names[id] ?? id,
        );
    const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;

    const low = pinned.filter((id) => {
        const item = items.find((it) => it.sourceGridKey === gridKey && it.itemid === id);
        return item !== undefined && isLowStock(item, stockRules);
    });

    let gain: { id: string; change: number } | null = null;
    let drop: { id: string; change: number } | null = null;
    for (const id of pinned) {
        const change = seriesStats(history?.byItem.get(id) ?? [], stepMillis).changeAbs;
        if (change === null) continue;
        if (change > 0 && (!gain || change > gain.change)) gain = { id, change };
        if (change < 0 && (!drop || change < drop.change)) drop = { id, change };
    }
    const signed = (n: number) => `${n > 0 ? "+" : "−"}${formatNumber(Math.abs(n), numberFormat)}`;

    return (
        <div className="kpis">
            <Kpi label="Pinned items" value={`${pinned.length}`} sub={`of at most ${MAX_PINNED}`} />
            <Kpi
                label="Below alert"
                value={`${low.length}`}
                sub={low.length > 0 ? low.map(nameOf).join(", ") : "Every pinned item is above its alert level"}
                tone={low.length > 0 ? "red" : undefined}
            />
            <Kpi
                label="Biggest gain"
                value={gain ? signed(gain.change) : "—"}
                sub={gain ? `${nameOf(gain.id)} · ${rangeLabel}` : "Nothing rose"}
                tone={gain ? "green" : undefined}
            />
            <Kpi
                label="Biggest drop"
                value={drop ? signed(drop.change) : "—"}
                sub={drop ? `${nameOf(drop.id)} · ${rangeLabel}` : "Nothing fell"}
                tone={drop ? "red" : undefined}
            />
        </div>
    );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "red" | "green" }) {
    return (
        <div className="kpi">
            <span className="section-label">{label}</span>
            <span className={tone ? `kpi__value ${tone}` : "kpi__value"}>{value}</span>
            <span className="kpi__sub" title={sub}>
                {sub}
            </span>
        </div>
    );
}
