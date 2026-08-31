// Hand-rolled SVG Gantt/floating-bar timeline (M5) - replaces the old webpage.html's two Chart.js
// "floating bar" charts (`showItemShare`/`showInterfaceShare`, `webpage.html:1325-1486` at commit
// 50bd3a1). Only the plot is SVG (`preserveAspectRatio="none"`, same technique as the Statistics
// sparkline) - labels and the value column stay in HTML so they're never stretched by the viewBox.
import { useState } from "preact/hooks";

import { formatDuration } from "../api/format";

export interface TimelineSegment {
    started: number;
    ended: number;
}

export interface TimelineRow {
    key: string;
    label: string;
    segments: TimelineSegment[];
    /** Right-aligned mono value shown for the row, e.g. an interface's total combined duration. */
    value?: string;
    /** Extra tooltip lines shown on every segment of this row (e.g. sorted interface locations). */
    tooltipExtra?: string[];
}

export interface TimelineProps {
    rows: TimelineRow[];
    /** `[timeStarted, timeDone]` of the job this timeline belongs to. */
    domain: [number, number];
    color: "purple" | "teal";
}

interface HoverState {
    rowKey: string;
    segIndex: number;
    pct: number;
}

function fmtClock(ms: number): string {
    return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({ rows, domain, color }: TimelineProps) {
    const [hover, setHover] = useState<HoverState | null>(null);
    const [domainStart, domainEnd] = domain;
    const span = Math.max(1, domainEnd - domainStart);
    const hasValue = rows.some((r) => r.value !== undefined);
    const fill = color === "teal" ? "var(--teal)" : "var(--accent)";

    const toPct = (ms: number) => Math.min(100, Math.max(0, ((ms - domainStart) / span) * 100));

    return (
        <div className="timeline">
            {rows.map((row) => (
                <div className="timeline__row" key={row.key}>
                    <span className="timeline__label" title={row.label}>
                        {row.label}
                    </span>
                    <div className="timeline__plot">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                            {row.segments.map((seg, i) => {
                                // `ended` can equal (or, defensively, slightly exceed) the job's own
                                // `timeDone` - clamp into the domain rather than trusting the server.
                                const startPct = toPct(seg.started);
                                const rawEndPct = toPct(Math.max(seg.ended, seg.started));
                                const endPct = Math.max(startPct + 0.6, rawEndPct); // 1px-ish minimum width
                                return (
                                    <rect
                                        key={i}
                                        className="timeline__segment"
                                        x={startPct}
                                        y={15}
                                        width={endPct - startPct}
                                        height={70}
                                        rx={2}
                                        fill={fill}
                                        tabIndex={0}
                                        onMouseEnter={() =>
                                            setHover({ rowKey: row.key, segIndex: i, pct: (startPct + endPct) / 2 })
                                        }
                                        onMouseLeave={() => setHover(null)}
                                        onFocus={() =>
                                            setHover({ rowKey: row.key, segIndex: i, pct: (startPct + endPct) / 2 })
                                        }
                                        onBlur={() => setHover(null)}
                                    />
                                );
                            })}
                        </svg>
                        {hover &&
                            hover.rowKey === row.key &&
                            (() => {
                                const seg = row.segments[hover.segIndex];
                                if (!seg) return null;
                                return (
                                    <div className="timeline__tooltip" style={{ left: `${hover.pct}%`, top: 0 }}>
                                        <span className="timeline__tooltip-line">From {fmtClock(seg.started)}</span>
                                        <span className="timeline__tooltip-line">To {fmtClock(seg.ended)}</span>
                                        <span className="timeline__tooltip-line">
                                            {formatDuration(seg.ended - seg.started)}
                                        </span>
                                        {row.tooltipExtra?.map((line) => (
                                            <span className="timeline__tooltip-line" key={line}>
                                                {line}
                                            </span>
                                        ))}
                                    </div>
                                );
                            })()}
                    </div>
                    {row.value !== undefined && <span className="timeline__value">{row.value}</span>}
                </div>
            ))}
            <div className="timeline__row timeline__row--axis">
                <span className="timeline__label" />
                <div className="timeline__plot timeline__plot--axis">
                    <span>{fmtClock(domainStart)}</span>
                    <span>{fmtClock((domainStart + domainEnd) / 2)}</span>
                    <span>{fmtClock(domainEnd)}</span>
                </div>
                {hasValue && <span className="timeline__value" />}
            </div>
        </div>
    );
}
