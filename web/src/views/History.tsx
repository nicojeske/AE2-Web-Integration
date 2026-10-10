import { useMemo, useState } from "preact/hooks";

import { formatDuration, formatNumber, formatTimestamp, skipSpecialFormat } from "../api/format";
import { useHistory } from "../state/history";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { useVirtualWindow } from "../ui/useVirtualWindow";
import type { HistoryEntry } from "../state/history";
import type { GridKey } from "../api/types";

export interface HistoryProps {
    onOpen: (entry: { gridKey: GridKey; id: number }) => void;
    /** The item filter (an itemid, from the URL's `?item=`), or `null` for every job. */
    item: string | null;
    onItemChange: (itemid: string | null) => void;
}

/** Suggestions shown under the item filter while typing. */
const MAX_ITEM_SUGGESTIONS = 8;

/** `.history-row`'s rendered height plus one `.history-list` row gap (`history.css`) - measured against
 *  the real layout, same reasoning as Browser's own `GRID_ROW_HEIGHT_PX` (`views/Browser.tsx`). */
const ROW_HEIGHT_PX = 66;
const OVERSCAN_ROWS = 6;

export function History({ onOpen, item, onItemChange }: HistoryProps) {
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
        <>
            <section className="browser__toolbar">
                {item ? (
                    <Button variant="pill" title="Show every item" onClick={() => pickItem(null)}>
                        Item: {skipSpecialFormat(nameOf(item))} ×
                    </Button>
                ) : (
                    <div className="compare__add">
                        <input
                            type="text"
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
                <Button variant="pill" onClick={() => setCancelledOnly((v) => !v)}>
                    {cancelledOnly ? "Cancelled only" : "All jobs"}
                </Button>
                <span className="browser__count">
                    {filtered.length} of {entries.length} shown
                </span>
            </section>

            {isAllGrids && failedGrids.length > 0 && (
                <p className="browser__warning">{`Couldn't load history from: ${failedGrids.join(", ")}`}</p>
            )}

            {filtered.length === 0 ? (
                <div className="placeholder-panel">
                    {item
                        ? `No ${cancelledOnly ? "cancelled " : ""}crafts of ${skipSpecialFormat(nameOf(item))} in this history.`
                        : cancelledOnly
                          ? "No cancelled jobs in this history."
                          : "No crafting history yet. Finished and cancelled jobs on a tracked network show up here."}
                </div>
            ) : (
                <section
                    className="history-list"
                    ref={setContainer}
                    style={{ paddingTop: topSpacerPx, paddingBottom: bottomSpacerPx }}
                >
                    {visible.map((entry: HistoryEntry) => (
                        <Card
                            key={entry.key}
                            clickable
                            className="history-row"
                            onClick={() => onOpen({ gridKey: entry.sourceGridKey, id: entry.id })}
                        >
                            <ItemIcon itemid={entry.finalOutput.itemid} name={entry.finalOutput.itemname} size={32} />
                            <div className="history-row__main">
                                <span className="history-row__item">
                                    <FormattedText text={entry.finalOutput.itemname} /> x
                                    {formatNumber(entry.finalOutput.quantity)}
                                    {isAllGrids && (
                                        <span className="history-row__grid-label"> - {entry.gridLabel}</span>
                                    )}
                                </span>
                                <span className="history-row__timestamp">
                                    {formatTimestamp(entry.timeDone)}
                                    {entry.requestedBy && ` - by ${entry.requestedBy}`}
                                </span>
                            </div>
                            <span className="history-row__duration">
                                {formatDuration(entry.timeDone - entry.timeStarted)}
                            </span>
                            <Badge variant={entry.wasCancelled ? "red" : "green"} size="sm">
                                {entry.wasCancelled ? "Cancelled" : "Completed"}
                            </Badge>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation(); // the row itself opens the detail page
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
                        </Card>
                    ))}
                </section>
            )}

            {hasMore && (
                <div className="history-more">
                    <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                        {loadingMore ? "Loading…" : "Load older jobs"}
                    </Button>
                </div>
            )}
        </>
    );
}
