// Statistics section (M8): range control, tracked-item chart cards, and the entry points into the
// Manage Tracked and Compare modals. Single-grid only - the tracked set and its cap are per-grid
// server-side (see REDESIGN_MILESTONES.md's M8 decision), so All-Grids mode gets a notice instead of
// a fan-out like every other section.
import { useState } from "preact/hooks";

import { formatAxisTime, formatNumber } from "../api/format";
import type { StatsRange } from "../api/types";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { useStats } from "../state/stats";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ExpandIcon } from "../ui/icons";
import { FormattedText } from "../ui/FormattedText";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Sparkline } from "../ui/Sparkline";
import { useItems } from "../state/items";
import { deltaPercent, describeResolution, lastNonGap, RANGE_OPTIONS, retentionNote } from "./statsModel";
import { CompareModal } from "./CompareModal";
import { CustomRangeInput } from "./CustomRangeInput";
import { ManageTrackedModal } from "./ManageTrackedModal";

export function Statistics() {
    const { selected, selectedGrid } = useNetwork();
    const { items } = useItems();
    const { statsViews, removeStatsView } = usePrefs();
    const stats = useStats();
    const [manageOpen, setManageOpen] = useState(false);
    const [compareIds, setCompareIds] = useState<string[] | null>(null);

    if (selected === "all") {
        return (
            <div className="placeholder-panel">
                Statistics is per-network. Pick a single network in the sidebar to see sampled item history.
            </div>
        );
    }

    if (!selectedGrid || selectedGrid.key === -1) {
        return <div className="placeholder-panel">No network selected.</div>;
    }

    const gridId = selectedGrid.key;
    const {
        range,
        setRange,
        customMinutes,
        setCustomMinutes,
        tracked,
        trackedError,
        history,
        historyLoading,
        refresh,
    } = stats;
    const views = statsViews.filter((v) => v.gridId === gridId);

    return (
        <>
            <section className="stats">
                <div className="stats__header">
                    <SegmentedControl<StatsRange> options={RANGE_OPTIONS} value={range} onChange={setRange} />
                    {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
                    <Button variant="secondary" size="sm" className="stats__manage" onClick={() => setManageOpen(true)}>
                        Manage tracked items
                    </Button>
                </div>

                {history && (
                    <p className="stats__meta">
                        {describeResolution(history.resolution, history.stepMillis)}
                        {range === "all" && ` · ${retentionNote(history.from, history.to)}`}
                    </p>
                )}

                {views.length > 0 && (
                    <div className="stats__views">
                        <span className="stats__views-label">Saved views</span>
                        {views.map((v) => (
                            <div key={v.id} className="stats__view-chip">
                                <button
                                    type="button"
                                    className="stats__view-chip-open"
                                    onClick={() => setCompareIds(v.itemids)}
                                >
                                    {v.name}
                                </button>
                                <button
                                    type="button"
                                    className="stats__view-chip-remove"
                                    title="Remove saved view"
                                    aria-label={`Remove saved view ${v.name}`}
                                    onClick={() => removeStatsView(v.id)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {trackedError && (
                    <div className="placeholder-panel browser__error">
                        <p>{trackedError}</p>
                        <Button variant="secondary" onClick={() => void refresh()}>
                            Retry
                        </Button>
                    </div>
                )}

                {tracked.length === 0 ? (
                    <div className="placeholder-panel">
                        No items tracked yet. Use &quot;Manage tracked items&quot; to choose what shows up here.
                    </div>
                ) : historyLoading && !history ? (
                    <div className="placeholder-panel">Loading statistics…</div>
                ) : (
                    <div className="stats__grid">
                        {tracked.map((itemid) => {
                            const item = items.find((it) => it.sourceGridId === gridId && it.itemid === itemid);
                            const values = history?.byItem.get(itemid) ?? [];
                            const timestamps = history?.timestamps ?? [];
                            const delta = deltaPercent(values);
                            const last = lastNonGap(values);
                            const currentDisplay =
                                item != null
                                    ? formatNumber(item.quantity)
                                    : last != null
                                      ? formatNumber(last.value)
                                      : "—";
                            const name = item?.itemname ?? itemid;
                            const startLabel =
                                timestamps.length > 0
                                    ? formatAxisTime(
                                          timestamps[0]!,
                                          range,
                                          history ? history.to - history.from : undefined,
                                      )
                                    : "";
                            const ariaLabel = `${name}, ${RANGE_OPTIONS.find((o) => o.value === range)?.label}`;
                            return (
                                <Card key={itemid} className="stat-card">
                                    <div className="stat-card__head">
                                        <div className="stat-card__identity">
                                            <FormattedText text={name} className="stat-card__name" />
                                            {!item && <span className="stat-card__missing">not on this network</span>}
                                            <span className="stat-card__value">{currentDisplay}</span>
                                        </div>
                                        <div className="stat-card__head-actions">
                                            {delta === null ? (
                                                <span title="Not enough samples yet">
                                                    <Badge variant="grey" size="sm">
                                                        n/a
                                                    </Badge>
                                                </span>
                                            ) : (
                                                <Badge variant={delta >= 0 ? "green" : "red"} size="sm">
                                                    {`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}
                                                </Badge>
                                            )}
                                            <button
                                                type="button"
                                                className="stat-card__expand"
                                                title="Compare over time"
                                                onClick={() => setCompareIds([itemid])}
                                            >
                                                <ExpandIcon />
                                            </button>
                                        </div>
                                    </div>
                                    <Sparkline
                                        values={values}
                                        timestamps={timestamps}
                                        range={range}
                                        spanMillis={history ? history.to - history.from : undefined}
                                        ariaLabel={ariaLabel}
                                    />
                                    <div className="stat-card__footer">
                                        <span>{startLabel}</span>
                                        <span>now</span>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </section>

            {manageOpen && <ManageTrackedModal onClose={() => setManageOpen(false)} />}
            {compareIds && <CompareModal itemids={compareIds} onClose={() => setCompareIds(null)} />}
        </>
    );
}
