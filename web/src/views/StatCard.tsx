// One tracked item's dashboard card (M8, chart-quality/derived-metrics pass). Lifted out of
// Statistics.tsx once that file grew past comfortably inlining a richer card - identity + delta badge
// + chart + a metrics strip, all driven by props so the parent owns every cross-item computation
// (statsModel's `seriesStats`/`timeToEmptyMillis`/`movingAverage`) exactly once per render instead of
// once per card duplicating the same work under a slightly different name.
import type { BrowserItem } from "../state/items";
import type { StatsRange } from "../api/types";
import { formatDuration, formatNumber } from "../api/format";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Chart, type ChartMarker } from "../ui/Chart";
import { ExpandIcon } from "../ui/icons";
import { FormattedText } from "../ui/FormattedText";
import {
    CARD_W,
    type ChartScale,
    lastNonGap,
    movingAverage,
    RANGE_OPTIONS,
    seriesStats,
    SMOOTHING_WINDOW,
    timeToEmptyMillis,
} from "./statsModel";

export interface StatCardProps {
    itemid: string;
    /** `undefined` when the tracked item is no longer present in the loaded item list. */
    item: BrowserItem | undefined;
    values: (number | null)[];
    timestamps: number[];
    range: StatsRange;
    /** Only meaningful for `range === "custom"` - see `formatAxisTime`. */
    spanMillis?: number;
    stepMillis: number;
    numberFormat: "full" | "compact";
    chartHeight: number;
    scale: ChartScale;
    smoothing: boolean;
    /** The favourite's `alertBelow`, or `null` when this item isn't favourited. */
    threshold: number | null;
    onExpand: () => void;
}

export function StatCard({
    itemid,
    item,
    values,
    timestamps,
    range,
    spanMillis,
    stepMillis,
    numberFormat,
    chartHeight,
    scale,
    smoothing,
    threshold,
    onExpand,
}: StatCardProps) {
    const stats = seriesStats(values, stepMillis);
    const last = lastNonGap(values);
    const currentDisplay =
        item != null
            ? formatNumber(item.quantity, numberFormat)
            : last != null
              ? formatNumber(last.value, numberFormat)
              : "—";
    const name = item?.itemname ?? itemid;
    const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
    const ariaLabel = `${name}, ${rangeLabel}`;

    const smoothedValues = smoothing ? movingAverage(values, SMOOTHING_WINDOW) : null;
    const toEmpty = timeToEmptyMillis(stats);
    const markers: ChartMarker[] =
        stats.minIndex !== null && stats.maxIndex !== null && stats.minIndex !== stats.maxIndex
            ? [
                  { index: stats.minIndex, kind: "min" },
                  { index: stats.maxIndex, kind: "max" },
              ]
            : [];

    return (
        <Card className="stat-card">
            <div className="stat-card__head">
                <div className="stat-card__identity">
                    <FormattedText text={name} className="stat-card__name" />
                    {!item && <span className="stat-card__missing">not on this network</span>}
                    <span className="stat-card__value">{currentDisplay}</span>
                </div>
                <div className="stat-card__head-actions">
                    {stats.changePct === null ? (
                        <span title="Not enough samples yet">
                            <Badge variant="grey" size="sm">
                                n/a
                            </Badge>
                        </span>
                    ) : (
                        <Badge variant={stats.changePct >= 0 ? "green" : "red"} size="sm">
                            {`${stats.changePct >= 0 ? "+" : ""}${stats.changePct.toFixed(1)}%`}
                        </Badge>
                    )}
                    <button type="button" className="stat-card__expand" title="Compare over time" onClick={onExpand}>
                        <ExpandIcon />
                    </button>
                </div>
            </div>
            <Chart
                values={values}
                smoothedValues={smoothedValues}
                timestamps={timestamps}
                range={range}
                spanMillis={spanMillis}
                width={CARD_W}
                height={chartHeight}
                scale={scale}
                numberFormat={numberFormat}
                showAxes
                markers={markers}
                threshold={threshold}
                ariaLabel={ariaLabel}
            />
            {stats.samples > 0 && (
                <div className="stat-card__metrics">
                    <span>
                        min <strong>{formatNumber(stats.min!, numberFormat)}</strong>
                    </span>
                    <span>
                        avg <strong>{formatNumber(Math.round(stats.avg!), numberFormat)}</strong>
                    </span>
                    <span>
                        max <strong>{formatNumber(stats.max!, numberFormat)}</strong>
                    </span>
                    {stats.slopePerHour !== null && (
                        <span>
                            {stats.slopePerHour >= 0 ? "+" : ""}
                            {formatNumber(Math.round(stats.slopePerHour), numberFormat)}/h
                        </span>
                    )}
                    {toEmpty !== null && (
                        <span className="stat-card__eta" title="Projected from the current trend, not a guarantee">
                            empty in ~{formatDuration(toEmpty)}
                        </span>
                    )}
                </div>
            )}
        </Card>
    );
}
