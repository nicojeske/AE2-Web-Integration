import { useMemo, useState } from "preact/hooks";

import { formatDuration, formatNumber, formatTimestamp } from "../api/format";
import { useHistory } from "../state/history";
import { useNetwork } from "../state/network";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import { useVirtualWindow } from "../ui/useVirtualWindow";
import type { HistoryEntry } from "../state/history";

export interface HistoryProps {
    onOpen: (entry: { gridId: number; id: number }) => void;
}

/** `.history-row`'s rendered height plus one `.history-list` row gap (`history.css`) - measured against
 *  the real layout, same reasoning as Browser's own `GRID_ROW_HEIGHT_PX` (`views/Browser.tsx`). */
const ROW_HEIGHT_PX = 66;
const OVERSCAN_ROWS = 6;

export function History({ onOpen }: HistoryProps) {
    const { entries, loading, error, failedGrids, refresh } = useHistory();
    const { selected, selectedGrid } = useNetwork();
    // Not persisted (unlike the Browser toolbar's filters) - a simple view toggle scoped to this visit,
    // matching how Statistics' own compare-range is also left as ephemeral local state.
    const [cancelledOnly, setCancelledOnly] = useState(false);

    const isAllGrids = selected === "all";
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

    if (selected !== "all" && (!selectedGrid || selectedGrid.key === -1)) {
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
                    {cancelledOnly
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
                            onClick={() => onOpen({ gridId: entry.sourceGridId, id: entry.id })}
                        >
                            <div className="history-row__main">
                                <span className="history-row__item">
                                    <FormattedText text={entry.finalOutput.itemname} />x
                                    {formatNumber(entry.finalOutput.quantity)}
                                    {isAllGrids && (
                                        <span className="history-row__grid-label"> - {entry.gridLabel}</span>
                                    )}
                                </span>
                                <span className="history-row__timestamp">{formatTimestamp(entry.timeDone)}</span>
                            </div>
                            <span className="history-row__duration">
                                {formatDuration(entry.timeDone - entry.timeStarted)}
                            </span>
                            <Badge variant={entry.wasCancelled ? "red" : "green"} size="sm">
                                {entry.wasCancelled ? "Cancelled" : "Completed"}
                            </Badge>
                        </Card>
                    ))}
                </section>
            )}
        </>
    );
}
