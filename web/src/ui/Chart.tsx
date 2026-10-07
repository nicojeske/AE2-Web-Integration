// Statistics chart (replaces the M8 Sparkline). Same technique as the original: an SVG plot with
// `preserveAspectRatio="none"` stretched to the container's width by a fixed-unit viewBox, with
// anything that must not be distorted by that stretch - dots, the crosshair, the tooltip, and now the
// axis labels and gridlines - either kept as HTML (percentage-positioned, matching Sparkline.tsx's
// original convention) or, for SVG strokes, given `vector-effect="non-scaling-stroke"` so a vertical
// gridline or marker ring isn't rendered ~4x thicker than a horizontal one under the same stretch.
import { formatAxisTime, formatNumber } from "../api/format";
import type { GTRange, StatsRange } from "../api/types";
import {
    chartGeometry,
    type ChartScale,
    extent,
    niceTicks,
    scaleValues,
    timeTickIndices,
    unscaleValue,
} from "../views/statsModel";
import { cx } from "./cx";
import { useChartHover } from "./useChartHover";

export interface ChartMarker {
    index: number;
    kind: "min" | "max";
}

export interface ChartProps {
    values: (number | null)[];
    /** Optional moving-average overlay over the same domain, drawn under the raw line. */
    smoothedValues?: (number | null)[] | null;
    timestamps: number[];
    range: StatsRange | GTRange;
    /** Only meaningful for `range === "custom"` - see `formatAxisTime`. */
    spanMillis?: number;
    /** Viewbox width unit the plot is stretched from - a geometry constant, not a CSS pixel count
     *  (see the file header note); taller/wider charts pass a bigger constant, not a measured size. */
    width: number;
    /** Literal CSS/SVG pixel height - never stretched. */
    height: number;
    scale?: ChartScale;
    numberFormat?: "full" | "compact";
    showAxes?: boolean;
    yTickCount?: number;
    xTickCount?: number;
    markers?: ChartMarker[];
    /** A dashed reference line at this raw (unscaled) value, e.g. a favourite's `alertBelow`. */
    threshold?: number | null;
    /** Base description (`"Iron Ingot, last 7 days"`) - the live region appends the hovered point. */
    ariaLabel: string;
    /** `"bars"` draws one bar per point from zero - for per-window sums (GT production), where a line
     *  would suggest a continuous level that was never sampled. Gaps simply have no bar. */
    variant?: "line" | "bars";
    /** Overrides `formatNumber` for the y-axis ticks and the hover label (e.g. `formatEU`). */
    formatValue?: (value: number) => string;
}

const PAD = 4;
const Y_AXIS_WIDTH = 34;
const X_AXIS_HEIGHT = 14;

export function Chart({
    values,
    smoothedValues,
    timestamps,
    range,
    spanMillis,
    width,
    height,
    scale = "linear",
    numberFormat = "full",
    showAxes = false,
    yTickCount = 3,
    xTickCount = 3,
    markers,
    threshold,
    ariaLabel,
    variant = "line",
    formatValue,
}: ChartProps) {
    const { index, handlers } = useChartHover(values.length);
    const fmt = formatValue ?? ((v: number) => formatNumber(v, numberFormat));
    const bars = variant === "bars";

    const scaled = scaleValues(values, scale);
    const dataBounds = extent(scaled);
    // Bars grow from zero, so zero must be inside the domain even when every value is far above it.
    const bounds =
        dataBounds && bars ? { min: Math.min(0, dataBounds.min), max: Math.max(0, dataBounds.max) } : dataBounds;

    const plotHeight = showAxes ? height - X_AXIS_HEIGHT : height;

    if (!bounds) {
        return (
            <div className="chart" role="img" aria-label={`${ariaLabel}, no samples yet`}>
                {showAxes && <div className="chart__y-axis" style={{ width: Y_AXIS_WIDTH }} />}
                <div className="chart__empty" style={{ height: plotHeight }}>
                    No samples yet
                </div>
            </div>
        );
    }

    const yOf = (v: number) => {
        const span = bounds.max - bounds.min;
        return span <= 0 ? plotHeight / 2 : plotHeight - PAD - ((v - bounds.min) / span) * (plotHeight - PAD * 2);
    };

    const lineGeo = chartGeometry(scaled, bounds.min, bounds.max, width, plotHeight, PAD);
    // Bars sit in equal slots, centred - edge-aligned line x positions would clip the first/last bar.
    const slotW = width / Math.max(1, scaled.length);
    const geo = bars
        ? {
              ...lineGeo,
              pts: scaled.map((v, i) => (v === null ? null : { x: (i + 0.5) * slotW, y: yOf(v) })),
          }
        : lineGeo;
    const smoothedScaled = smoothedValues ? scaleValues(smoothedValues, scale) : null;
    const smoothedGeo = smoothedScaled
        ? chartGeometry(smoothedScaled, bounds.min, bounds.max, width, plotHeight, PAD)
        : null;

    const yTickValues = showAxes ? niceTicks(bounds.min, bounds.max, yTickCount) : [];
    const xTickIdxs = showAxes ? timeTickIndices(timestamps.length, xTickCount) : [];
    const thresholdScaled = threshold != null ? scaleValues([threshold], scale)[0] : null;

    const point = index === null ? null : (geo.pts[index] ?? null);
    const value = index === null ? null : (values[index] ?? null);
    const hoverTimestamp = index === null ? null : (timestamps[index] ?? null);
    const hoverLabel =
        index === null || hoverTimestamp === null
            ? ""
            : value === null
              ? `${formatAxisTime(hoverTimestamp, range, spanMillis)} · No data`
              : `${formatAxisTime(hoverTimestamp, range, spanMillis)} · ${fmt(value)}`;

    return (
        <div className="chart">
            {showAxes && (
                <div className="chart__y-axis" style={{ width: Y_AXIS_WIDTH, height: plotHeight }}>
                    {yTickValues.map((t) => (
                        <span key={t} className="chart__y-tick" style={{ top: `${(yOf(t) / plotHeight) * 100}%` }}>
                            {fmt(unscaleValue(t, scale))}
                        </span>
                    ))}
                </div>
            )}
            <div className="chart__body">
                <div
                    className="chart__plot"
                    style={{ height: plotHeight }}
                    tabIndex={0}
                    role="img"
                    aria-label={ariaLabel}
                    onMouseMove={handlers.onMouseMove}
                    onMouseLeave={handlers.onMouseLeave}
                    onKeyDown={handlers.onKeyDown}
                    onBlur={handlers.onBlur}
                >
                    <svg
                        viewBox={`0 0 ${width} ${plotHeight}`}
                        width="100%"
                        height={plotHeight}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        {yTickValues.map((t) => (
                            <line
                                key={t}
                                className="chart__gridline"
                                x1={0}
                                x2={width}
                                y1={yOf(t)}
                                y2={yOf(t)}
                                vector-effect="non-scaling-stroke"
                            />
                        ))}
                        {thresholdScaled != null && (
                            <line
                                className="chart__threshold"
                                x1={0}
                                x2={width}
                                y1={yOf(thresholdScaled)}
                                y2={yOf(thresholdScaled)}
                                vector-effect="non-scaling-stroke"
                            />
                        )}
                        {smoothedGeo && (
                            <path
                                className="chart__line chart__line--smoothed"
                                d={smoothedGeo.linePath}
                                vector-effect="non-scaling-stroke"
                            />
                        )}
                        {bars ? (
                            geo.pts.map((p, i) => {
                                if (!p) return null;
                                const base = yOf(0);
                                return (
                                    <rect
                                        key={i}
                                        className={cx("chart__bar", index === i && "chart__bar--hover")}
                                        x={i * slotW + slotW * 0.15}
                                        width={slotW * 0.7}
                                        y={Math.min(p.y, base)}
                                        height={Math.max(Math.abs(base - p.y), 0.5)}
                                    />
                                );
                            })
                        ) : (
                            <>
                                <path className="chart__area" d={geo.areaPath} />
                                <path className="chart__line" d={geo.linePath} vector-effect="non-scaling-stroke" />
                            </>
                        )}
                        {markers?.map((m) => {
                            const p = geo.pts[m.index];
                            if (!p) return null;
                            return (
                                <circle
                                    key={m.kind}
                                    className={`chart__marker chart__marker--${m.kind}`}
                                    cx={p.x}
                                    cy={p.y}
                                    r={3}
                                    vector-effect="non-scaling-stroke"
                                />
                            );
                        })}
                    </svg>
                    {point && !bars && (
                        <div
                            className="chart__dot"
                            style={{ left: `${(point.x / width) * 100}%`, top: `${(point.y / plotHeight) * 100}%` }}
                        />
                    )}
                    {index !== null && (
                        <div
                            className="chart__tooltip"
                            style={{
                                left: `${((point?.x ?? geo.pts[index]?.x ?? width / 2) / width) * 100}%`,
                                top: `${((point?.y ?? plotHeight / 2) / plotHeight) * 100}%`,
                            }}
                        >
                            {hoverLabel}
                        </div>
                    )}
                    <span className="sr-only" aria-live="polite">
                        {hoverLabel}
                    </span>
                </div>
                {showAxes && (
                    <div className="chart__x-axis">
                        {xTickIdxs.map((i) => {
                            const t = timestamps[i];
                            if (t === undefined) return null;
                            const pct = bars
                                ? ((i + 0.5) / timestamps.length) * 100
                                : timestamps.length <= 1
                                  ? 50
                                  : (i / (timestamps.length - 1)) * 100;
                            const anchor = pct < 8 ? "start" : pct > 92 ? "end" : "center";
                            return (
                                <span
                                    key={i}
                                    className={`chart__x-tick chart__x-tick--${anchor}`}
                                    style={{ left: `${pct}%` }}
                                >
                                    {formatAxisTime(t, range, spanMillis)}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
