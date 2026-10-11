import { useMemo, useState } from "preact/hooks";

import { formatDuration, formatNumber, formatTimestamp, skipSpecialFormat } from "../api/format";
import { useHistory } from "../state/history";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { Inspector } from "../ui/Inspector";
import { ItemIcon } from "../ui/ItemIcon";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useVirtualWindow } from "../ui/useVirtualWindow";
import type { HistoryEntry } from "../state/history";
import type { GridKey } from "../api/types";
import { TrackingDetail } from "./TrackingDetail";

export interface HistoryProps {
    /** The job in the inspector (the URL's detail), or `null`. */
    open: { gridKey: GridKey; id: number } | null;
    onOpen: (entry: { gridKey: GridKey; id: number } | null) => void;
    /** The item filter (an itemid, from the URL's `?item=`), or `null` for every job. */
    item: string | null;
    onItemChange: (itemid: string | null) => void;
}

/** Suggestions shown under the item filter while typing. */
const MAX_ITEM_SUGGESTIONS = 8;

/** `.history-row`'s fixed height (`history.css`). */
const ROW_HEIGHT_PX = 44;
const OVERSCAN_ROWS = 6;

export function History({ open, onOpen, item, onItemChange }: HistoryProps) {
    const { entries, loading, error, failedGrids, refresh, hasMore, loadingMore, loadMore } = useHistory();
    const { items } = useItems();
    const [itemQuery, setItemQuery] = useState("");
    const { selected, selectedGrid } = useNetwork();
    const { startOrder } = useOrder();
    // Not persisted (unlike the Browser toolbar's filters) - a simple view toggle scoped to this visit,
    // matching how Statistics' own compare-range is also left as ephemeral local state.
    const [cancelledOnly, setCancelledOnly] = useState(false);

    const isAllGrids = selected === "all";

    // Names by itemid: the loaded items, then history rows (an item that has left storage keeps its name there).
    const nameOf = useMemo(() => {
        const names = new Map<string, string>();
        for (const e of entries) names.set(e.finalOutput.itemid, e.finalOutput.itemname);
        for (const it of items) names.set(it.itemid, it.itemname);
        return (itemid: string) => names.get(itemid) ?? itemid;
    }, [entries, items]);

    const suggestions = useMemo(() => {
        const q = itemQuery.trim().toLowerCase();
        if (!q) return [];
        const seen = new Set<string>();
        const out: { itemid: string; name: string }[] = [];
        for (const it of items) {
            if (seen.has(it.itemid)) continue;
            if (!it.plainName.toLowerCase().includes(q) && !it.itemid.toLowerCase().includes(q)) continue;
            seen.add(it.itemid);
            out.push({ itemid: it.itemid, name: it.itemname });
            if (out.length >= MAX_ITEM_SUGGESTIONS) break;
        }
        return out;
    }, [items, itemQuery]);

    const pickItem = (itemid: string | null) => {
        setItemQuery("");
        onItemChange(itemid);
    };
    const filtered = useMemo(
        () => (cancelledOnly ? entries.filter((e) => e.wasCancelled) : entries),
        [entries, cancelledOnly],
    );

    // State (via a callback ref), not `useRef` - see `ui/useMeasuredColumns`'s comment for why a plain
    // ref would silently stop working here (the list mounts behind a loading placeholder on the very
    // first render).
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const { startRow, endRow, topSpacerPx, bottomSpacerPx } = useVirtualWindow(
        container,
        filtered.length,
        ROW_HEIGHT_PX,
        OVERSCAN_ROWS,
    );
    const visible = filtered.slice(startRow, endRow);

    if (selected !== "all" && !selectedGrid) {
        return <div className="placeholder-panel">No network selected.</div>;
    }

    if (loading && entries.length === 0) {
        return <div className="placeholder-panel">Loading crafting history…</div>;
    }

    if (error) {
        return (
            <div className="placeholder-panel browser__error">
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void refresh()}>
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page__main">
                <header className="page-header">
                    <h2 className="page-header__title">History</h2>
                    {item ? (
                        <button
                            type="button"
                            className="chip chip--active"
                            title="Show every item"
                            onClick={() => pickItem(null)}
                        >
                            {skipSpecialFormat(nameOf(item))} ×
                        </button>
                    ) : (
                        <div className="compare__add history__filter">
                            <input
                                type="text"
                                className="field"
                                placeholder="Filter by item…"
                                aria-label="Filter by item"
                                value={itemQuery}
                                onInput={(e) => setItemQuery((e.target as HTMLInputElement).value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && suggestions[0]) pickItem(suggestions[0].itemid);
                                    if (e.key === "Escape") setItemQuery("");
                                }}
                            />
                            {suggestions.length > 0 && (
                                <div className="compare__dropdown">
                                    {suggestions.map((s) => (
                                        <button
                                            key={s.itemid}
                                            type="button"
                                            className="compare__dropdown-row"
                                            onClick={() => pickItem(s.itemid)}
                                        >
                                            {skipSpecialFormat(s.name)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <SegmentedControl
                        options={[
                            { value: "all", label: "All jobs" },
                            { value: "cancelled", label: "Cancelled" },
                        ]}
                        value={cancelledOnly ? "cancelled" : "all"}
                        onChange={(v) => setCancelledOnly(v === "cancelled")}
                    />
                    <span className="page-header__end mono-count">
                        {filtered.length} of {entries.length} shown
                    </span>
                </header>

                {isAllGrids && failedGrids.length > 0 && (
                    <p className="browser__warning">{`Couldn't load history from: ${failedGrids.join(", ")}`}</p>
                )}

                <div className="page__scroll">
                    {filtered.length === 0 ? (
                        <div className="placeholder-panel">
                            {item
                                ? `No ${cancelledOnly ? "cancelled " : ""}crafts of ${skipSpecialFormat(nameOf(item))} in this history.`
                                : cancelledOnly
                                  ? "No cancelled jobs in this history."
                                  : "No crafting history yet. Finished and cancelled jobs on a tracked network show up here."}
                        </div>
                    ) : (
                        <div className="dtable history-table">
                            <div className="dtable__head">
                                <span />
                                <span>Output</span>
                                <span>Finished ↓</span>
                                <span className="right">Took</span>
                                <span>Result</span>
                                <span />
                            </div>
                            <div ref={setContainer} style={{ paddingTop: topSpacerPx, paddingBottom: bottomSpacerPx }}>
                                {visible.map((entry: HistoryEntry) => (
                                    <div
                                        key={entry.key}
                                        className={cx(
                                            "dtable__row dtable__row--clickable history-row",
                                            open?.gridKey === entry.sourceGridKey &&
                                                open.id === entry.id &&
                                                "dtable__row--selected",
                                        )}
                                        onClick={() => onOpen({ gridKey: entry.sourceGridKey, id: entry.id })}
                                    >
                                        <ItemIcon
                                            itemid={entry.finalOutput.itemid}
                                            name={entry.finalOutput.itemname}
                                            size={26}
                                        />
                                        <div className="cell-stack">
                                            <span className="cell-text">
                                                <FormattedText text={entry.finalOutput.itemname} />{" "}
                                                <span className="history-row__qty">
                                                    ×{formatNumber(entry.finalOutput.quantity)}
                                                </span>
                                            </span>
                                            <span className="cell-sub">
                                                {entry.requestedBy ? `by ${entry.requestedBy}` : "unknown requester"}
                                                {isAllGrids ? ` · ${entry.gridLabel}` : ""}
                                            </span>
                                        </div>
                                        <span className="history-row__when">{formatTimestamp(entry.timeDone)}</span>
                                        <span className="cell-num">
                                            {formatDuration(entry.timeDone - entry.timeStarted)}
                                        </span>
                                        <Badge variant={entry.wasCancelled ? "red" : "green"} size="sm">
                                            {entry.wasCancelled ? "Cancelled" : "Completed"}
                                        </Badge>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation(); // the row itself opens the record
                                                startOrder({
                                                    sourceGridKey: entry.sourceGridKey,
                                                    itemid: entry.finalOutput.itemid,
                                                    itemname: entry.finalOutput.itemname,
                                                    quantity: entry.finalOutput.quantity,
                                                });
                                            }}
                                        >
                                            Craft again
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {hasMore && (
                        <div className="history-more">
                            <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                                {loadingMore ? "Loading…" : "Load older jobs"}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
            <Inspector
                label="Job"
                width={440}
                open={open !== null}
                onClose={() => onOpen(null)}
                placeholder="Select a job to see its steps, what it consumed and where the time went."
            >
                {open && (
                    <TrackingDetail
                        key={`${open.gridKey}:${open.id}`}
                        gridKey={open.gridKey}
                        id={open.id}
                        onShowItemHistory={(itemid) => onItemChange(itemid)}
                    />
                )}
            </Inspector>
        </div>
    );
}
