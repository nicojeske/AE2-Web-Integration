// Statistics chart card sparkline (M8). Only the plot is SVG (`preserveAspectRatio="none"`, same
// technique as Timeline.tsx) - the hover dot and tooltip stay HTML so they aren't stretched into an
// ellipse by the non-uniform viewBox scaling.
import { formatAxisTime, formatNumber } from "../api/format";
import type { StatsRange } from "../api/types";
import { CARD_H, CARD_PAD, CARD_W, chartGeometry, extent } from "../views/statsModel";
import { useChartHover } from "./useChartHover";

export interface SparklineProps {
    values: (number | null)[];
    timestamps: number[];
    range: StatsRange;
    /** Base description (`"Iron Ingot, last 7 days"`) - the live region appends the hovered point. */
    ariaLabel: string;
}

export function Sparkline({ values, timestamps, range, ariaLabel }: SparklineProps) {
    const { index, handlers } = useChartHover(values.length);
    const bounds = extent(values);

    if (!bounds) {
        return (
            <div className="sparkline sparkline--empty" role="img" aria-label={`${ariaLabel}, no samples yet`}>
                No samples yet
            </div>
        );
    }

    const geo = chartGeometry(values, bounds.min, bounds.max, CARD_W, CARD_H, CARD_PAD);
    const point = index === null ? null : (geo.pts[index] ?? null);
    const value = index === null ? null : (values[index] ?? null);
    const hoverTimestamp = index === null ? null : (timestamps[index] ?? null);
    const hoverLabel =
        index === null || hoverTimestamp === null
            ? ""
            : value === null
              ? `${formatAxisTime(hoverTimestamp, range)} · No data`
              : `${formatAxisTime(hoverTimestamp, range)} · ${formatNumber(value)}`;

    return (
        <div
            className="sparkline"
            tabIndex={0}
            role="img"
            aria-label={ariaLabel}
            onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}
            onKeyDown={handlers.onKeyDown}
            onBlur={handlers.onBlur}
        >
            <svg
                viewBox={`0 0 ${CARD_W} ${CARD_H}`}
                width="100%"
                height={CARD_H}
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <path className="sparkline__area" d={geo.areaPath} />
                <path className="sparkline__line" d={geo.linePath} />
            </svg>
            {point && (
                <div
                    className="sparkline__dot"
                    style={{ left: `${(point.x / CARD_W) * 100}%`, top: `${(point.y / CARD_H) * 100}%` }}
                />
            )}
            {index !== null && (
                <div
                    className="sparkline__tooltip"
                    style={{
                        left: `${((point?.x ?? geo.pts[index]?.x ?? CARD_W / 2) / CARD_W) * 100}%`,
                        top: `${((point?.y ?? CARD_H / 2) / CARD_H) * 100}%`,
                    }}
                >
                    {hoverLabel}
                </div>
            )}
            <span className="sr-only" aria-live="polite">
                {hoverLabel}
            </span>
        </div>
    );
}
