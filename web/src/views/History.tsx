import { formatDuration, formatNumber, formatTimestamp } from "../api/format";
import { useHistory } from "../state/history";
import { useNetwork } from "../state/network";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import type { HistoryEntry } from "../state/history";

export interface HistoryProps {
    onOpen: (entry: { gridId: number; id: number }) => void;
}

export function History({ onOpen }: HistoryProps) {
    const { entries, loading, error, failedGrids, refresh } = useHistory();
    const { selected, selectedGrid } = useNetwork();

    const isAllGrids = selected === "all";

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
            {isAllGrids && failedGrids.length > 0 && (
                <p className="browser__warning">{`Couldn't load history from: ${failedGrids.join(", ")}`}</p>
            )}

            {entries.length === 0 ? (
                <div className="placeholder-panel">
                    No crafting history yet. Finished and cancelled jobs on a tracked network show up here.
                </div>
            ) : (
                <section className="history-list">
                    {entries.map((entry: HistoryEntry) => (
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
