// The Browser's per-item panel: stock trend, recent crafts and the item's stock rule in one place, from data
// the server already exposes. Not URL-addressable, like the Browser's other overlays.
import { useEffect, useState } from "preact/hooks";

import { getItemHistory, getTrackingHistory } from "../api/client";
import { describeApiError } from "../api/errors";
import { formatDuration, formatNumber, formatTimestamp } from "../api/format";
import type { GridKey, StatsRange, TrackingHistoryElement } from "../api/types";
import type { BrowserItem } from "../state/items";
import { prefsKey, usePrefs } from "../state/prefs";
import { MAX_PINNED, toBundle, type HistoryBundle } from "../state/stats";
import { useStockRules } from "../state/stockRules";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { Drawer } from "../ui/Drawer";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { SegmentedControl } from "../ui/SegmentedControl";
import { CARD_W } from "./statsModel";
import { StockRuleEditor } from "./StockRuleEditor";

const RANGES: SegmentedOption<StatsRange>[] = [
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
];
const CHART_POINTS = 120;
const RECENT_CRAFTS = 5;

export interface ItemDetailProps {
    item: BrowserItem;
    onClose: () => void;
    onCraft: (item: BrowserItem) => void;
    /** Crafting History filtered to this item. */
    onOpenHistory: (itemid: string) => void;
    onOpenCraft: (entry: { gridKey: GridKey; id: number }) => void;
}

type Loaded<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string };

export function ItemDetail({ item, onClose, onCraft, onOpenHistory, onOpenCraft }: ItemDetailProps) {
    const { isFavorite, toggleFavorite, statsPinned, setStatsPinned, settings } = usePrefs();
    const { rules } = useStockRules();
    const [range, setRange] = useState<StatsRange>("7d");
    const [history, setHistory] = useState<Loaded<HistoryBundle>>({ state: "loading" });
    const [crafts, setCrafts] = useState<Loaded<TrackingHistoryElement[]>>({ state: "loading" });

    const gridKey = item.sourceGridKey;
    const key = prefsKey(gridKey, item.itemid);
    const rule = rules[key] ?? null;
    const pinned = statsPinned[gridKey] ?? [];
    const isPinned = pinned.includes(item.itemid);

    useEffect(() => {
        let cancelled = false;
        setHistory({ state: "loading" });
        getItemHistory(gridKey, range, CHART_POINTS, [item.itemid]).then(
            (result) => !cancelled && setHistory({ state: "ok", data: toBundle(result) }),
            (e) => !cancelled && setHistory({ state: "error", message: describeApiError(e, "No history") }),
        );
        return () => {
            cancelled = true;
        };
    }, [gridKey, item.itemid, range]);

    useEffect(() => {
        let cancelled = false;
        getTrackingHistory(gridKey, { itemid: item.itemid, limit: RECENT_CRAFTS }).then(
            (rows) => !cancelled && setCrafts({ state: "ok", data: rows }),
            (e) => !cancelled && setCrafts({ state: "error", message: describeApiError(e, "No crafting history") }),
        );
        return () => {
            cancelled = true;
        };
    }, [gridKey, item.itemid]);

    const values = history.state === "ok" ? (history.data.byItem.get(item.itemid) ?? []) : [];

    return (
        <Drawer
            title={item.plainName}
            subtitle={`${item.mod} - ${item.gridLabel}`}
            onClose={onClose}
            footer={
                <div className="item-detail__actions">
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-pressed={isFavorite(key)}
                        onClick={() => toggleFavorite(gridKey, item.itemid)}
                    >
                        {isFavorite(key) ? "Unfavorite" : "Favorite"}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!isPinned && pinned.length >= MAX_PINNED}
                        onClick={() =>
                            setStatsPinned(
                                gridKey,
                                isPinned ? pinned.filter((id) => id !== item.itemid) : [...pinned, item.itemid],
                            )
                        }
                    >
                        {isPinned ? "Unpin from Statistics" : "Pin to Statistics"}
                    </Button>
                    {item.craftable && (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={item.itemKey === null}
                            onClick={() => onCraft(item)}
                        >
                            Craft
                        </Button>
                    )}
                </div>
            }
        >
            <div className="item-detail">
                <div className="item-detail__stored">
                    <span className="item-detail__stored-value">
                        {formatNumber(item.quantity, settings.numberFormat)}
                    </span>
                    <span className="item-detail__label">stored</span>
                    {item.craftable && (
                        <Badge variant="teal" size="sm">
                            Craftable
                        </Badge>
                    )}
                </div>

                <section className="item-detail__section">
                    <div className="item-detail__section-head">
                        <h3 className="item-detail__heading">Stock</h3>
                        <SegmentedControl<StatsRange> options={RANGES} value={range} onChange={setRange} />
                    </div>
                    {history.state === "loading" && <p className="item-detail__empty">Loading…</p>}
                    {history.state === "error" && <p className="item-detail__empty">{history.message}</p>}
                    {history.state === "ok" &&
                        (values.some((v) => v !== null) ? (
                            <Chart
                                values={values}
                                timestamps={history.data.timestamps}
                                range={range}
                                width={CARD_W}
                                height={120}
                                showAxes
                                numberFormat={settings.numberFormat}
                                threshold={rule?.alertBelow ?? null}
                                ariaLabel={`${item.plainName}, stored over the last ${range}`}
                            />
                        ) : (
                            <p className="item-detail__empty">No samples in this range yet.</p>
                        ))}
                </section>

                <section className="item-detail__section">
                    <h3 className="item-detail__heading">Stock rule</h3>
                    <p className="item-detail__hint">
                        Shared with this network's players. The server checks it with no browser open.
                    </p>
                    <StockRuleEditor
                        gridKey={gridKey}
                        itemid={item.itemid}
                        rule={rule}
                        stored={item.quantity}
                        numberFormat={settings.numberFormat}
                    />
                </section>

                <section className="item-detail__section">
                    <div className="item-detail__section-head">
                        <h3 className="item-detail__heading">Recent crafts</h3>
                        <button type="button" className="item-detail__link" onClick={() => onOpenHistory(item.itemid)}>
                            View all in History
                        </button>
                    </div>
                    {crafts.state === "loading" && <p className="item-detail__empty">Loading…</p>}
                    {crafts.state === "error" && <p className="item-detail__empty">{crafts.message}</p>}
                    {crafts.state === "ok" && crafts.data.length === 0 && (
                        <p className="item-detail__empty">No crafts of this item recorded.</p>
                    )}
                    {crafts.state === "ok" && crafts.data.length > 0 && (
                        <ul className="item-detail__crafts">
                            {crafts.data.map((c) => (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        className="item-detail__craft"
                                        onClick={() => onOpenCraft({ gridKey, id: c.id })}
                                    >
                                        <span>
                                            {formatNumber(c.finalOutput.quantity, settings.numberFormat)}x in{" "}
                                            {formatDuration(c.timeDone - c.timeStarted)}
                                            {c.requestedBy ? ` - by ${c.requestedBy}` : ""}
                                        </span>
                                        <span className="item-detail__craft-meta">
                                            {c.wasCancelled ? "Cancelled · " : ""}
                                            {formatTimestamp(c.timeDone)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <p className="item-detail__id">{item.itemid}</p>
            </div>
        </Drawer>
    );
}
