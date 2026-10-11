import { useEffect, useState } from "preact/hooks";

import { getTracking } from "../api/client";
import { describeApiError } from "../api/errors";
import type { GridKey, ResourceRef, TrackingDetail as TrackingDetailData } from "../api/types";
import { formatNumber } from "../api/format";
import { useOrder } from "../state/order";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { SectionLabel } from "../ui/SectionLabel";
import { Timeline } from "../ui/Timeline";
import { ConsumedSection } from "./craftDetailParts";
import { JobItemDetail } from "./JobItemDetail";
import { buildTrackingDetail } from "./trackingDetailModel";

export interface TrackingDetailProps {
    gridKey: GridKey;
    id: number;
    /** Crafting History filtered to this job's output. */
    onShowItemHistory: (itemid: string) => void;
}

/**
 * One finished job's record in the History inspector. The record is immutable once it exists, so this
 * fetches once per job - no polling, no ticking clock.
 */
export function TrackingDetail({ gridKey, id, onShowItemHistory }: TrackingDetailProps) {
    const [detail, setDetail] = useState<TrackingDetailData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [openItem, setOpenItem] = useState<ResourceRef | null>(null);
    const { startOrder } = useOrder();

    useEffect(() => {
        let cancelled = false;
        setDetail(null);
        setError(null);
        getTracking(gridKey, id)
            .then((d) => {
                if (!cancelled) setDetail(d);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(describeApiError(e, "Couldn't load this job's tracking data"));
            });
        return () => {
            cancelled = true;
        };
    }, [gridKey, id]);

    if (error) return <p className="item-panel__empty">{error}</p>;
    if (!detail) return <p className="item-panel__empty">Loading tracking data…</p>;

    const view = buildTrackingDetail(detail);
    const missingItemRows = detail.items.length - view.itemTimelineRows.length;
    const missingInterfaceRows = detail.interfaceShare.length - view.interfaceTimelineRows.length;

    return (
        <div className="tracking">
            <div className="tracking__head">
                <ItemIcon itemid={detail.finalOutput.itemid} name={view.outputName} size={44} />
                <div className="tracking__title-block">
                    <span className="tracking__title">
                        <FormattedText text={view.outputName} />{" "}
                        <span className="craft__qty">×{formatNumber(view.outputQty)}</span>
                    </span>
                    <span className="tracking__sub">
                        {detail.requestedBy ? `by ${detail.requestedBy}` : "Crafting history"}
                    </span>
                </div>
                <Badge variant={view.statusVariant} size="sm">
                    {view.statusLabel}
                </Badge>
            </div>

            <div className="kv-grid tracking__stats">
                {view.stats.map((st) => (
                    <div className="kv-grid__cell" key={st.label}>
                        <span className="kv-grid__key">{st.label}</span>
                        <span className="kv-grid__value kv-grid__value--mono">{st.value}</span>
                    </div>
                ))}
            </div>

            {view.items.length > 0 && (
                <div className="tracking__steps">
                    <div className="tracking__step tracking__step--head">
                        <span />
                        <span>Step</span>
                        <span className="right">Crafted</span>
                        <span className="right">Time</span>
                    </div>
                    {view.items.map((row) => (
                        <button
                            type="button"
                            key={row.itemid}
                            className="tracking__step-row"
                            title={`${row.rate} · stock, history and stock rule`}
                            onClick={() => setOpenItem(row)}
                        >
                            <div className="tracking__step">
                                <ItemIcon itemid={row.itemid} name={row.itemname} size={20} />
                                <FormattedText text={row.itemname} className="cell-text tracking__step-name" />
                                <span className="cell-num">{row.crafted}</span>
                                <span className="cell-num dim">{row.time}</span>
                            </div>
                            <div className="tracking__share">
                                <div style={{ width: `${Math.round((row.sharePct ?? 0) * 100)}%` }} />
                            </div>
                        </button>
                    ))}
                </div>
            )}

            <ConsumedSection rows={view.consumed} onOpenItem={setOpenItem} />

            <section className="tracking__timeline">
                <SectionLabel>Item share</SectionLabel>
                {view.itemTimelineRows.length > 0 ? (
                    <Timeline rows={view.itemTimelineRows} domain={view.domain} color="purple" />
                ) : (
                    <span className="item-panel__empty">No per-item timing recorded.</span>
                )}
                {missingItemRows > 0 && <span className="item-panel__empty">+{missingItemRows} more not shown</span>}
            </section>
            <section className="tracking__timeline">
                <SectionLabel>Interface share</SectionLabel>
                {view.interfaceTimelineRows.length > 0 ? (
                    <Timeline rows={view.interfaceTimelineRows} domain={view.domain} color="teal" />
                ) : (
                    <span className="item-panel__empty">No interface usage recorded.</span>
                )}
                {missingInterfaceRows > 0 && (
                    <span className="item-panel__empty">+{missingInterfaceRows} more not shown</span>
                )}
            </section>

            <div className="tracking__actions">
                <Button
                    variant="primary"
                    className="tracking__again"
                    onClick={() =>
                        startOrder({
                            sourceGridKey: gridKey,
                            itemid: detail.finalOutput.itemid,
                            itemname: detail.finalOutput.itemname,
                            quantity: detail.finalOutput.quantity,
                        })
                    }
                >
                    Craft again ×{formatNumber(detail.finalOutput.quantity)}
                </Button>
                <Button variant="secondary" onClick={() => onShowItemHistory(detail.finalOutput.itemid)}>
                    All crafts of this item
                </Button>
            </div>
            {openItem && <JobItemDetail gridKey={gridKey} item={openItem} onClose={() => setOpenItem(null)} />}
        </div>
    );
}
