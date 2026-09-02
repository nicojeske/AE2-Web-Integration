// Statistics dashboard header (chart-quality/derived-metrics pass) - a KPI row plus one aggregate
// chart, both computed from the `history` bundle `state/stats.tsx` already polls; no extra requests.
import type { StatsRange } from "../api/types";
import { formatNumber, formatRelativeAge } from "../api/format";
import type { HistoryBundle } from "../state/stats";
import type { BrowserItem } from "../state/items";
import type { Thresholds } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Chart } from "../ui/Chart";
import { isLowStock } from "./browserModel";
import { COMPARE_W, deltaPercent, describeResolution, seriesStats, sumSeries } from "./statsModel";

export interface StatsOverviewProps {
    gridId: number;
    tracked: string[];
    trackedLimit: number;
    items: BrowserItem[];
    favorites: Record<string, true>;
    thresholds: Record<string, Thresholds>;
    history: HistoryBundle | null;
    range: StatsRange;
    spanMillis?: number;
    numberFormat: "full" | "compact";
}

export function StatsOverview({
    gridId,
    tracked,
    trackedLimit,
    items,
    favorites,
    thresholds,
    history,
    range,
    spanMillis,
    numberFormat,
}: StatsOverviewProps) {
    const stepMillis = history?.stepMillis ?? 0;
    const totalSeries = sumSeries(tracked.map((id) => history?.byItem.get(id) ?? []));
    const totalStats = seriesStats(totalSeries, stepMillis);
    const netChangePct = deltaPercent(totalSeries);

    let rising = 0;
    let falling = 0;
    let flat = 0;
    for (const id of tracked) {
        const s = seriesStats(history?.byItem.get(id) ?? [], stepMillis);
        if (s.slopePerHour === null) continue;
        if (s.slopePerHour > 0) rising++;
        else if (s.slopePerHour < 0) falling++;
        else flat++;
    }

    let lowStockCount = 0;
    for (const id of tracked) {
        const item = items.find((it) => it.sourceGridId === gridId && it.itemid === id);
        // Reuses the Browser badge's own rule - a tracked item only counts here if it's favourited
        // (otherwise it has no `alertBelow` to compare against) and still on the network.
        if (item && isLowStock(item, favorites, thresholds)) lowStockCount++;
    }

    return (
        <div className="stats-overview">
            <div className="stats-overview__tiles">
                <Card className="stats-tile">
                    <span className="stats-tile__label">Tracked</span>
                    <span className="stats-tile__value">
                        {tracked.length}/{trackedLimit}
                    </span>
                </Card>
                <Card className="stats-tile">
                    <span className="stats-tile__label">Net change</span>
                    <span className="stats-tile__value">
                        {totalStats.changeAbs === null
                            ? "—"
                            : `${totalStats.changeAbs >= 0 ? "+" : ""}${formatNumber(totalStats.changeAbs, numberFormat)}`}
                    </span>
                    {netChangePct !== null && (
                        <Badge variant={netChangePct >= 0 ? "green" : "red"} size="sm">
                            {`${netChangePct >= 0 ? "+" : ""}${netChangePct.toFixed(1)}%`}
                        </Badge>
                    )}
                </Card>
                <Card className="stats-tile">
                    <span className="stats-tile__label">Rising / falling</span>
                    <span className="stats-tile__value">
                        {rising} / {falling}
                    </span>
                    {flat > 0 && <span className="stats-tile__sub">{flat} flat</span>}
                </Card>
                <Card className="stats-tile">
                    <span className="stats-tile__label">Low stock</span>
                    <span className={`stats-tile__value${lowStockCount > 0 ? " stats-tile__value--warn" : ""}`}>
                        {lowStockCount}
                    </span>
                </Card>
                <Card className="stats-tile">
                    <span className="stats-tile__label">Freshness</span>
                    <span className="stats-tile__value stats-tile__value--sm">
                        {history ? formatRelativeAge(history.fetchedAt) : "—"}
                    </span>
                    {history && (
                        <span className="stats-tile__sub">
                            {describeResolution(history.resolution, history.stepMillis)}
                        </span>
                    )}
                </Card>
            </div>
            {history && totalStats.samples > 0 && (
                <Card className="stats-overview__chart-card">
                    <span className="stats-overview__chart-title">Total tracked stock</span>
                    <Chart
                        values={totalSeries}
                        timestamps={history.timestamps}
                        range={range}
                        spanMillis={spanMillis}
                        width={COMPARE_W}
                        height={90}
                        numberFormat={numberFormat}
                        showAxes
                        ariaLabel="Total tracked stock"
                    />
                </Card>
            )}
        </div>
    );
}
