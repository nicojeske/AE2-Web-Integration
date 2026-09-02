// Compare-over-time modal (M8). Normalises every series to % of its own first non-gap value (see
// statsModel.normalizeSeries) and draws them on one shared y-domain so trends are comparable
// regardless of each item's absolute scale.
import { useEffect, useMemo, useState } from "preact/hooks";

import { formatAxisTime, formatNumber } from "../api/format";
import type { StatsRange } from "../api/types";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { useStats } from "../state/stats";
import { Button } from "../ui/Button";
import { useChartHover } from "../ui/useChartHover";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Modal } from "../ui/Modal";
import { CustomRangeInput } from "./CustomRangeInput";
import {
    chartGeometry,
    COMPARE_H,
    COMPARE_PAD,
    COMPARE_W,
    MAX_COMPARE_SERIES,
    niceTicks,
    normalizeSeries,
    RANGE_OPTIONS,
    sharedDomain,
    timeTickIndices,
} from "./statsModel";

export interface CompareModalProps {
    itemids: string[];
    onClose: () => void;
}

export function CompareModal({ itemids, onClose }: CompareModalProps) {
    const { selectedGrid } = useNetwork();
    const { items } = useItems();
    const { addStatsView } = usePrefs();
    const {
        compareRange,
        setCompareRange,
        compareCustomMinutes,
        setCompareCustomMinutes,
        compareHistory,
        setCompareActive,
        tracked,
    } = useStats();

    const [ids, setIds] = useState<string[]>(itemids.slice(0, MAX_COMPARE_SERIES));
    const [addQuery, setAddQuery] = useState("");
    const [savingView, setSavingView] = useState(false);
    const [viewName, setViewName] = useState("");

    useEffect(() => {
        setCompareActive(true);
        return () => setCompareActive(false);
    }, [setCompareActive]);

    const gridId = selectedGrid?.key ?? null;
    const nameOf = useMemo(() => {
        const byId = new Map<string, string>();
        for (const item of items) {
            if (item.sourceGridId === gridId) byId.set(item.itemid, item.plainName);
        }
        return (itemid: string) => byId.get(itemid) ?? itemid;
    }, [items, gridId]);

    const series = useMemo(() => {
        return ids.map((id) => {
            const values = compareHistory?.byItem.get(id) ?? [];
            return normalizeSeries(id, values);
        });
    }, [ids, compareHistory]);

    const domain = sharedDomain(series);
    const geometries = series.map((s) =>
        chartGeometry(s.normalized, domain.min, domain.max, COMPARE_W, COMPARE_H, COMPARE_PAD),
    );
    const count = compareHistory?.count ?? 0;
    const { index: hoverIndex, handlers } = useChartHover(count);
    const timestamps = compareHistory?.timestamps ?? [];

    const flaggedModes = series.filter((s) => s.mode === "peak" || s.mode === "flat");

    // Add-item dropdown lists only tracked items - an untracked id has no history at all, just an
    // all-gap blank line (REDESIGN_MILESTONES.md's M8 decision).
    const addOptions = useMemo(() => {
        const q = addQuery.trim().toLowerCase();
        return tracked
            .filter((id) => !ids.includes(id))
            .filter((id) => !q || nameOf(id).toLowerCase().includes(q) || id.toLowerCase().includes(q))
            .slice(0, 8);
    }, [tracked, ids, addQuery, nameOf]);

    const atCap = ids.length >= MAX_COMPARE_SERIES;

    return (
        <Modal
            onClose={onClose}
            width={760}
            backdrop="var(--backdrop-compare)"
            header={
                <div className="compare__title-row">
                    <span className="modal__title">Compare over time</span>
                    <SegmentedControl<StatsRange>
                        options={RANGE_OPTIONS}
                        value={compareRange}
                        onChange={setCompareRange}
                        className="compare__range"
                    />
                    {compareRange === "custom" && (
                        <CustomRangeInput minutes={compareCustomMinutes} onChange={setCompareCustomMinutes} />
                    )}
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
            }
        >
            <div className="compare__toolbar">
                <div className="compare__add">
                    <input
                        type="text"
                        placeholder={atCap ? "Up to 6 items" : "+ Add item to compare"}
                        value={addQuery}
                        disabled={atCap}
                        onInput={(e) => setAddQuery((e.target as HTMLInputElement).value)}
                    />
                    {addQuery && addOptions.length > 0 && (
                        <div className="compare__dropdown">
                            {addOptions.map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    className="compare__dropdown-row"
                                    onClick={() => {
                                        setIds((cur) => [...cur, id]);
                                        setAddQuery("");
                                    }}
                                >
                                    {nameOf(id)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="compare__save">
                    {savingView && (
                        <input
                            type="text"
                            placeholder="View name..."
                            value={viewName}
                            onInput={(e) => setViewName((e.target as HTMLInputElement).value)}
                        />
                    )}
                    {savingView ? (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={viewName.trim().length === 0}
                            onClick={() => {
                                if (gridId === null || viewName.trim().length === 0) return;
                                addStatsView({ gridId, name: viewName.trim(), itemids: ids, range: compareRange });
                                setSavingView(false);
                                setViewName("");
                            }}
                        >
                            Save
                        </Button>
                    ) : (
                        <Button variant="secondary" size="sm" onClick={() => setSavingView(true)}>
                            Save view
                        </Button>
                    )}
                </div>
            </div>

            <div className="compare__legend">
                {series.map((s, i) => (
                    <div key={s.itemid} className={`compare__chip${s.mode === "none" ? " compare__chip--empty" : ""}`}>
                        <span
                            className="compare__chip-dot"
                            style={{ backgroundColor: `var(--series-${(i % 6) + 1})` }}
                        />
                        {nameOf(s.itemid)}
                        <button
                            type="button"
                            className="compare__chip-remove"
                            aria-label={`Remove ${nameOf(s.itemid)} from comparison`}
                            onClick={() => setIds((cur) => cur.filter((x) => x !== s.itemid))}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            {series.length === 0 ? (
                <p className="compare__empty">No items selected - add one above.</p>
            ) : (
                <>
                    {(() => {
                        const yOf = (v: number) =>
                            COMPARE_H -
                            COMPARE_PAD -
                            ((v - domain.min) / (domain.max - domain.min || 1)) * (COMPARE_H - COMPARE_PAD * 2);
                        const yTicks = niceTicks(domain.min, domain.max, 4);
                        const xTickIdxs = timeTickIndices(timestamps.length, 4);
                        return (
                            <div className="chart">
                                <div className="chart__y-axis" style={{ width: 34, height: COMPARE_H }}>
                                    {yTicks.map((t) => (
                                        <span
                                            key={t}
                                            className="chart__y-tick"
                                            style={{ top: `${(yOf(t) / COMPARE_H) * 100}%` }}
                                        >
                                            {Math.round(t)}%
                                        </span>
                                    ))}
                                </div>
                                <div className="chart__body">
                                    <div
                                        className="compare__plot"
                                        {...handlers}
                                        tabIndex={0}
                                        role="img"
                                        aria-label="Compare chart"
                                    >
                                        <svg
                                            viewBox={`0 0 ${COMPARE_W} ${COMPARE_H}`}
                                            width="100%"
                                            height={COMPARE_H}
                                            preserveAspectRatio="none"
                                            aria-hidden="true"
                                        >
                                            {yTicks.map((t) => (
                                                <line
                                                    key={t}
                                                    className="chart__gridline"
                                                    x1={0}
                                                    x2={COMPARE_W}
                                                    y1={yOf(t)}
                                                    y2={yOf(t)}
                                                    vector-effect="non-scaling-stroke"
                                                />
                                            ))}
                                            <line
                                                className="compare__reference"
                                                x1={0}
                                                x2={COMPARE_W}
                                                y1={yOf(100)}
                                                y2={yOf(100)}
                                                vector-effect="non-scaling-stroke"
                                            />
                                            {geometries.map((g, i) => (
                                                <path
                                                    key={series[i]!.itemid}
                                                    className={`compare__line compare__line--${(i % 6) + 1}`}
                                                    d={g.linePath}
                                                    vector-effect="non-scaling-stroke"
                                                />
                                            ))}
                                        </svg>
                                        {hoverIndex !== null && count > 0 && (
                                            <div
                                                className="compare__hover-line"
                                                style={{ left: `${(hoverIndex / (count - 1 || 1)) * 100}%` }}
                                            />
                                        )}
                                    </div>
                                    <div className="chart__x-axis">
                                        {xTickIdxs.map((i) => {
                                            const t = timestamps[i];
                                            if (t === undefined) return null;
                                            const pct =
                                                timestamps.length <= 1 ? 50 : (i / (timestamps.length - 1)) * 100;
                                            const anchor = pct < 8 ? "start" : pct > 92 ? "end" : "center";
                                            return (
                                                <span
                                                    key={i}
                                                    className={`chart__x-tick chart__x-tick--${anchor}`}
                                                    style={{ left: `${pct}%` }}
                                                >
                                                    {formatAxisTime(
                                                        t,
                                                        compareRange,
                                                        compareHistory
                                                            ? compareHistory.to - compareHistory.from
                                                            : undefined,
                                                    )}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                    <p className="compare__caption">
                        Each line is % of that item&apos;s first recorded value in this range. Hover for raw counts.
                        {flaggedModes.length > 0 && (
                            <span className="compare__caption-note">
                                {" "}
                                {flaggedModes
                                    .map((s) => `${nameOf(s.itemid)} started at 0 - scaled to its own peak instead.`)
                                    .join(" ")}
                            </span>
                        )}
                    </p>
                    <div className="compare__readout">
                        {series.map((s, i) => {
                            const idx = hoverIndex;
                            const values = compareHistory?.byItem.get(s.itemid) ?? [];
                            const raw = idx !== null ? values[idx] : lastRaw(values);
                            const label =
                                idx !== null && timestamps[idx] !== undefined
                                    ? formatAxisTime(
                                          timestamps[idx],
                                          compareRange,
                                          compareHistory ? compareHistory.to - compareHistory.from : undefined,
                                      )
                                    : "latest";
                            return (
                                <div key={s.itemid} className="compare__readout-row">
                                    <span
                                        className="compare__chip-dot"
                                        style={{ backgroundColor: `var(--series-${(i % 6) + 1})` }}
                                    />
                                    <span className="compare__readout-name">{nameOf(s.itemid)}</span>
                                    <span className="compare__readout-label">{label}</span>
                                    <span className="compare__readout-value">
                                        {raw == null ? "—" : formatNumber(raw)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </Modal>
    );
}

function lastRaw(values: (number | null)[]): number | null {
    for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        if (v !== null && v !== undefined) return v;
    }
    return null;
}
