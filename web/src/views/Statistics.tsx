// Statistics section (M8, dashboard/chart-quality pass): range control, an overview KPI row, and
// pinned-item chart cards, plus the entry points into the Pinned Items and Compare modals.
// Single-grid only - history is per grid server-side, so All-Grids mode gets a notice instead of a
// fan-out like every other section.
import { useState } from "preact/hooks";

import { describeResolution, retentionNote } from "./statsModel";
import type { StatsRange } from "../api/types";
import { prefsKey, usePrefs } from "../state/prefs";
import { useStats } from "../state/stats";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useItems } from "../state/items";
import { alertBelowFor } from "./browserModel";
import { CHART_SCALE_OPTIONS, CHART_SIZE_PX, RANGE_OPTIONS } from "./statsModel";
import { CompareModal } from "./CompareModal";
import { CustomRangeInput } from "./CustomRangeInput";
import { ManagePinnedModal } from "./ManagePinnedModal";
import { StatCard } from "./StatCard";
import { StatsOverview } from "./StatsOverview";
import { useNetwork } from "../state/network";
import { useStockRules } from "../state/stockRules";

export function Statistics() {
    const { selected, selectedGrid } = useNetwork();
    const { items } = useItems();
    const { statsViews, removeStatsView, settings, setSettings } = usePrefs();
    const { rules: stockRules } = useStockRules();
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

    if (!selectedGrid) {
        return <div className="placeholder-panel">No network selected.</div>;
    }

    const gridKey = selectedGrid.key;
    const {
        range,
        setRange,
        customMinutes,
        setCustomMinutes,
        pinned,
        names,
        history,
        historyLoading,
        historyError,
        refresh,
        setCompareRange,
    } = stats;
    const views = statsViews.filter((v) => v.gridKey === gridKey);
    const spanMillis = history ? history.to - history.from : undefined;
    const chartHeight = CHART_SIZE_PX[settings.statsChartSize];

    const openView = (v: (typeof views)[number]) => {
        setCompareRange(v.range);
        setCompareIds(v.itemids);
    };

    return (
        <>
            <section className="stats">
                <div className="stats__header">
                    <SegmentedControl<StatsRange> options={RANGE_OPTIONS} value={range} onChange={setRange} />
                    {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
                    <SegmentedControl
                        options={CHART_SCALE_OPTIONS}
                        value={settings.chartScale}
                        onChange={(chartScale) => setSettings((s) => ({ ...s, chartScale }))}
                    />
                    <Checkbox
                        checked={settings.chartSmoothing}
                        onChange={(chartSmoothing) => setSettings((s) => ({ ...s, chartSmoothing }))}
                        title="Overlay a moving average to damp per-sample noise"
                    >
                        <span>Smoothing</span>
                    </Checkbox>
                    <Button variant="secondary" size="sm" className="stats__manage" onClick={() => setManageOpen(true)}>
                        Choose items
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
                                <button type="button" className="stats__view-chip-open" onClick={() => openView(v)}>
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

                {historyError === "HISTORY_DISABLED" ? (
                    <div className="placeholder-panel">
                        This server records no item history - it needs a history database (history.jdbc_url in the
                        mod&apos;s config).
                    </div>
                ) : historyError ? (
                    <div className="placeholder-panel browser__error">
                        <p>{historyError}</p>
                        <Button variant="secondary" onClick={() => void refresh()}>
                            Retry
                        </Button>
                    </div>
                ) : pinned.length === 0 ? (
                    <div className="placeholder-panel">
                        Every item&apos;s stock is recorded. Use &quot;Choose items&quot; to pick which ones show up
                        here.
                    </div>
                ) : historyLoading && !history ? (
                    <div className="placeholder-panel">Loading statistics…</div>
                ) : (
                    <>
                        <StatsOverview
                            gridKey={gridKey}
                            pinned={pinned}
                            items={items}
                            stockRules={stockRules}
                            history={history}
                            range={range}
                            spanMillis={spanMillis}
                            numberFormat={settings.numberFormat}
                        />
                        <div className="stats__grid">
                            {pinned.map((itemid) => {
                                const item = items.find((it) => it.sourceGridKey === gridKey && it.itemid === itemid);
                                const key = prefsKey(gridKey, itemid);
                                const threshold = alertBelowFor(stockRules, key);
                                return (
                                    <StatCard
                                        key={itemid}
                                        itemid={itemid}
                                        item={item}
                                        storedName={names[itemid]}
                                        values={history?.byItem.get(itemid) ?? []}
                                        timestamps={history?.timestamps ?? []}
                                        range={range}
                                        spanMillis={spanMillis}
                                        stepMillis={history?.stepMillis ?? 0}
                                        numberFormat={settings.numberFormat}
                                        chartHeight={chartHeight}
                                        scale={settings.chartScale}
                                        smoothing={settings.chartSmoothing}
                                        threshold={threshold}
                                        onExpand={() => setCompareIds([itemid])}
                                    />
                                );
                            })}
                        </div>
                    </>
                )}
            </section>

            {manageOpen && <ManagePinnedModal onClose={() => setManageOpen(false)} />}
            {compareIds && <CompareModal itemids={compareIds} onClose={() => setCompareIds(null)} />}
        </>
    );
}
