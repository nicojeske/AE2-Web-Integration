// An item's stock trend, stock rule and recent crafts, from data the server already exposes. Two shells use
// them: the Item Browser's inspector (`ItemInspector`, with the inline craft box) and the slide-over item
// panel that crafting jobs and history open (`ItemDetail`).
import { useEffect, useState } from "preact/hooks";

import { getItemHistory, getTrackingHistory } from "../api/client";
import { describeApiError } from "../api/errors";
import { formatBytes, formatDuration, formatNumber, formatTimestamp } from "../api/format";
import type { GridKey, StatsRange, StockRule, TrackingHistoryElement } from "../api/types";
import { useCpus } from "../state/cpus";
import type { BrowserItem } from "../state/items";
import { prefsKey, usePrefs } from "../state/prefs";
import { MAX_PINNED, toBundle, type HistoryBundle } from "../state/stats";
import { useStockRules } from "../state/stockRules";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { Drawer } from "../ui/Drawer";
import { ItemIcon } from "../ui/ItemIcon";
import { StarIcon } from "../ui/icons";
import { SectionLabel } from "../ui/SectionLabel";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StockRuleEditor } from "./StockRuleEditor";

const RANGES: SegmentedOption<StatsRange>[] = [
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "6h", label: "6h" },
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
];
const CHART_POINTS = 120;
/** Viewbox width of the stock chart - it stretches to the panel. */
const CHART_W = 400;
/** Matches the server's default 1-minute item sampling. */
const HISTORY_POLL_MS = 60_000;
const RECENT_CRAFTS = 5;

type Loaded<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string };

export interface ItemLinks {
    /** Crafting History filtered to this item. */
    onOpenHistory: (itemid: string) => void;
    onOpenCraft: (entry: { gridKey: GridKey; id: number }) => void;
}

function useRule(item: BrowserItem): StockRule | null {
    const { rules } = useStockRules();
    return rules[prefsKey(item.sourceGridKey, item.itemid)] ?? null;
}

/** Where the stored amount sits against the item's stock rule, for the bar under the stored count. */
function ruleProgress(stored: number, rule: StockRule) {
    const target = rule.keepStock > 0 ? rule.keepStock : rule.alertBelow;
    if (target <= 0) return null;
    const color = stored < rule.alertBelow ? "var(--red)" : stored < rule.keepStock ? "var(--amber)" : "var(--cyan)";
    return { target, fraction: Math.min(1, stored / target), color };
}

function StockSection({ item, rule }: { item: BrowserItem; rule: StockRule | null }) {
    const { settings } = usePrefs();
    const [range, setRange] = useState<StatsRange>("7d");
    const [history, setHistory] = useState<Loaded<HistoryBundle>>({ state: "loading" });
    const gridKey = item.sourceGridKey;

    useEffect(() => {
        let cancelled = false;
        const load = () =>
            getItemHistory(gridKey, range, CHART_POINTS, [item.itemid]).then(
                (result) => !cancelled && setHistory({ state: "ok", data: toBundle(result) }),
                (e) => !cancelled && setHistory({ state: "error", message: describeApiError(e, "No history") }),
            );
        setHistory({ state: "loading" });
        void load();
        // Refreshes keep the current chart up until the new one arrives, rather than flashing "Loading".
        const timer = setInterval(() => {
            if (!document.hidden) void load();
        }, HISTORY_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [gridKey, item.itemid, range]);

    const values = history.state === "ok" ? (history.data.byItem.get(item.itemid) ?? []) : [];
    // The last point is the window containing "now", and the server reports each window's newest value, so
    // the live stored count belongs there - the chart follows the item list between history polls.
    const liveValues = values.length > 0 ? [...values.slice(0, -1), item.quantity] : values;

    return (
        <section className="item-panel__section">
            <SectionLabel
                end={
                    <SegmentedControl<StatsRange>
                        className="segmented--mono"
                        options={RANGES}
                        value={range}
                        onChange={setRange}
                    />
                }
            >
                Stock
            </SectionLabel>
            {history.state === "loading" && <p className="item-panel__empty">Loading…</p>}
            {history.state === "error" && <p className="item-panel__empty">{history.message}</p>}
            {history.state === "ok" &&
                (values.some((v) => v !== null) ? (
                    <Chart
                        values={liveValues}
                        timestamps={history.data.timestamps}
                        range={range}
                        width={CHART_W}
                        height={120}
                        showAxes
                        numberFormat={settings.numberFormat}
                        threshold={rule?.alertBelow ?? null}
                        ariaLabel={`${item.plainName}, stored over the last ${range}`}
                    />
                ) : (
                    <p className="item-panel__empty">No samples in this range yet.</p>
                ))}
        </section>
    );
}

function RuleSection({ item, rule }: { item: BrowserItem; rule: StockRule | null }) {
    const { settings } = usePrefs();
    return (
        <section className="item-panel__section">
            <SectionLabel>Stock rule</SectionLabel>
            <p className="item-panel__hint">
                Shared with this network's players. The server checks it with no browser open.
            </p>
            <StockRuleEditor
                gridKey={item.sourceGridKey}
                itemid={item.itemid}
                rule={rule}
                stored={item.quantity}
                numberFormat={settings.numberFormat}
            />
        </section>
    );
}

function CraftsSection({ item, links }: { item: BrowserItem; links: ItemLinks }) {
    const { settings } = usePrefs();
    const [crafts, setCrafts] = useState<Loaded<TrackingHistoryElement[]>>({ state: "loading" });
    const gridKey = item.sourceGridKey;

    useEffect(() => {
        let cancelled = false;
        setCrafts({ state: "loading" });
        getTrackingHistory(gridKey, { itemid: item.itemid, limit: RECENT_CRAFTS }).then(
            (rows) => !cancelled && setCrafts({ state: "ok", data: rows }),
            (e) => !cancelled && setCrafts({ state: "error", message: describeApiError(e, "No crafting history") }),
        );
        return () => {
            cancelled = true;
        };
    }, [gridKey, item.itemid]);

    return (
        <section className="item-panel__section">
            <SectionLabel
                end={
                    <button type="button" className="btn btn--text" onClick={() => links.onOpenHistory(item.itemid)}>
                        View all in History
                    </button>
                }
            >
                Recent crafts
            </SectionLabel>
            {crafts.state === "loading" && <p className="item-panel__empty">Loading…</p>}
            {crafts.state === "error" && <p className="item-panel__empty">{crafts.message}</p>}
            {crafts.state === "ok" && crafts.data.length === 0 && (
                <p className="item-panel__empty">No crafts of this item recorded.</p>
            )}
            {crafts.state === "ok" && crafts.data.length > 0 && (
                <ul className="item-panel__crafts">
                    {crafts.data.map((c) => (
                        <li key={c.id}>
                            <button
                                type="button"
                                className="item-panel__craft"
                                onClick={() => links.onOpenCraft({ gridKey, id: c.id })}
                            >
                                <span>
                                    {formatNumber(c.finalOutput.quantity, settings.numberFormat)}x in{" "}
                                    {formatDuration(c.timeDone - c.timeStarted)}
                                    {c.requestedBy ? ` - by ${c.requestedBy}` : ""}
                                </span>
                                <span
                                    className={c.wasCancelled ? "item-panel__craft-meta red" : "item-panel__craft-meta"}
                                >
                                    {c.wasCancelled ? "Cancelled · " : ""}
                                    {formatTimestamp(c.timeDone)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function PinButton({ item }: { item: BrowserItem }) {
    const { statsPinned, setStatsPinned } = usePrefs();
    const pinned = statsPinned[item.sourceGridKey] ?? [];
    const isPinned = pinned.includes(item.itemid);
    return (
        <Button
            variant="secondary"
            size="sm"
            disabled={!isPinned && pinned.length >= MAX_PINNED}
            onClick={() =>
                setStatsPinned(
                    item.sourceGridKey,
                    isPinned ? pinned.filter((id) => id !== item.itemid) : [...pinned, item.itemid],
                )
            }
        >
            {isPinned ? "Unpin from Statistics" : "Pin to Statistics"}
        </Button>
    );
}

export interface CraftRequest {
    quantity: number;
    /** A CPU picked in the craft box; the plan's default otherwise. */
    cpuKey?: string;
}

/** The inspector's inline order box: quantity with presets, a CPU, and "Plan craft". */
function CraftBox({
    item,
    rule,
    onCraft,
}: {
    item: BrowserItem;
    rule: StockRule | null;
    onCraft: (r: CraftRequest) => void;
}) {
    const { cpus } = useCpus();
    const [quantity, setQuantity] = useState(64);
    const [cpuKey, setCpuKey] = useState("");
    useEffect(() => {
        setQuantity(64);
        setCpuKey("");
    }, [item.sourceGridKey, item.itemid]);

    const toRule = rule && rule.keepStock > item.quantity ? rule.keepStock - item.quantity : null;
    const idle = cpus
        .filter((c) => c.sourceGridKey === item.sourceGridKey && !c.isBusy)
        .sort((a, b) => b.availableStorage - a.availableStorage);
    const orderable = item.itemKey !== null;
    const submit = () => {
        if (orderable && quantity >= 1) onCraft({ quantity, cpuKey: cpuKey || undefined });
    };

    return (
        <section className="craft-box">
            <SectionLabel>Craft</SectionLabel>
            <div className="craft-box__row">
                <input
                    id="craft-qty"
                    className="field field--mono craft-box__qty"
                    type="number"
                    min={1}
                    value={quantity}
                    aria-label="Quantity"
                    onInput={(e) => setQuantity(Math.max(0, Math.trunc(Number((e.target as HTMLInputElement).value))))}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") submit();
                    }}
                />
                {[64, 1000].map((n) => (
                    <button
                        key={n}
                        type="button"
                        className={quantity === n ? "craft-box__preset craft-box__preset--on" : "craft-box__preset"}
                        onClick={() => setQuantity(n)}
                    >
                        {n === 1000 ? "1k" : n}
                    </button>
                ))}
                {toRule !== null && (
                    <button
                        type="button"
                        className={
                            quantity === toRule ? "craft-box__preset craft-box__preset--on" : "craft-box__preset"
                        }
                        title={`Up to the stock rule's ${formatNumber(rule!.keepStock)}`}
                        onClick={() => setQuantity(toRule)}
                    >
                        To rule
                    </button>
                )}
            </div>
            <label className="craft-box__cpu">
                <span>CPU</span>
                <select value={cpuKey} onChange={(e) => setCpuKey((e.target as HTMLSelectElement).value)}>
                    <option value="">Auto</option>
                    {idle.map((c) => (
                        <option key={c.cpuKey} value={c.cpuKey}>
                            {c.name} ({formatBytes(c.availableStorage)} free)
                        </option>
                    ))}
                </select>
            </label>
            <Button
                variant="primary"
                className="craft-box__go"
                disabled={!orderable || quantity < 1}
                title={
                    orderable ? undefined : "AE2 can't identify this item uniquely, so it can't be ordered from here"
                }
                onClick={submit}
            >
                Plan craft <span className="craft-box__key">⏎</span>
            </Button>
        </section>
    );
}

export interface ItemInspectorProps extends ItemLinks {
    item: BrowserItem;
    onCraft: (item: BrowserItem, request: CraftRequest) => void;
}

/** The Item Browser's inspector. */
export function ItemInspector({ item, onCraft, ...links }: ItemInspectorProps) {
    const { isFavorite, toggleFavorite, settings } = usePrefs();
    const rule = useRule(item);
    const favorited = isFavorite(prefsKey(item.sourceGridKey, item.itemid));
    const progress = rule ? ruleProgress(item.quantity, rule) : null;

    return (
        <div className="item-panel">
            <div className="item-panel__head">
                <ItemIcon itemid={item.itemid} name={item.itemname} size={56} />
                <div className="item-panel__title">
                    <span className="item-panel__name">{item.plainName}</span>
                    <span className="item-panel__mod">
                        {item.mod}
                        {item.gridLabel ? ` · ${item.gridLabel}` : ""}
                    </span>
                    <span className="item-panel__id">{item.itemid}</span>
                </div>
                <button
                    type="button"
                    className="item-panel__star"
                    title={favorited ? "Unfavorite" : "Favorite"}
                    aria-pressed={favorited}
                    style={{ color: favorited ? "var(--amber)" : "var(--star-inactive)" }}
                    onClick={() => toggleFavorite(item.sourceGridKey, item.itemid)}
                >
                    <StarIcon size={18} />
                </button>
            </div>

            <div className="item-panel__stored-block">
                <div className="item-panel__stored">
                    <span className="item-panel__stored-value">
                        {formatNumber(item.quantity, settings.numberFormat)}
                    </span>
                    <span className="item-panel__label">stored</span>
                </div>
                {progress && rule && (
                    <>
                        <div className="bar">
                            <div
                                className="bar__fill"
                                style={{ width: `${progress.fraction * 100}%`, background: progress.color }}
                            />
                        </div>
                        <div className="item-panel__rule-line">
                            <span style={{ color: progress.color }}>
                                {Math.round((item.quantity / progress.target) * 100)}% of stock rule
                            </span>
                            <span>
                                {rule.keepStock > 0
                                    ? `keep ≥ ${formatNumber(rule.keepStock, settings.numberFormat)}`
                                    : `alert < ${formatNumber(rule.alertBelow, settings.numberFormat)}`}
                            </span>
                        </div>
                    </>
                )}
            </div>

            {item.craftable && <CraftBox item={item} rule={rule} onCraft={(r) => onCraft(item, r)} />}
            <StockSection item={item} rule={rule} />
            <RuleSection item={item} rule={rule} />
            <CraftsSection item={item} links={links} />
            <div className="item-panel__actions">
                <PinButton item={item} />
            </div>
        </div>
    );
}

export interface ItemDetailProps extends ItemLinks {
    item: BrowserItem;
    onClose: () => void;
    onCraft: (item: BrowserItem) => void;
}

/** The slide-over item panel crafting jobs and history open. */
export function ItemDetail({ item, onClose, onCraft, ...links }: ItemDetailProps) {
    const { isFavorite, toggleFavorite, settings } = usePrefs();
    const rule = useRule(item);
    const key = prefsKey(item.sourceGridKey, item.itemid);

    return (
        <Drawer
            title={item.plainName}
            subtitle={[item.mod, item.gridLabel].filter(Boolean).join(" · ")}
            onClose={onClose}
            footer={
                <>
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-pressed={isFavorite(key)}
                        onClick={() => toggleFavorite(item.sourceGridKey, item.itemid)}
                    >
                        {isFavorite(key) ? "Unfavorite" : "Favorite"}
                    </Button>
                    <PinButton item={item} />
                    {item.craftable && (
                        <Button
                            variant="primary"
                            size="sm"
                            className="item-panel__craft-btn"
                            disabled={item.itemKey === null}
                            onClick={() => onCraft(item)}
                        >
                            Craft
                        </Button>
                    )}
                </>
            }
        >
            <div className="item-panel">
                <div className="item-panel__stored">
                    <ItemIcon itemid={item.itemid} name={item.itemname} size={40} />
                    <span className="item-panel__stored-value">
                        {formatNumber(item.quantity, settings.numberFormat)}
                    </span>
                    <span className="item-panel__label">stored</span>
                    {item.craftable && (
                        <Badge variant="teal" size="sm">
                            Craftable
                        </Badge>
                    )}
                </div>
                <StockSection item={item} rule={rule} />
                <RuleSection item={item} rule={rule} />
                <CraftsSection item={item} links={links} />
                <span className="item-panel__id">{item.itemid}</span>
            </div>
        </Drawer>
    );
}
