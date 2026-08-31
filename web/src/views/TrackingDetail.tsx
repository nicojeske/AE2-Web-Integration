import { useEffect, useState } from "preact/hooks";

import { getTracking } from "../api/client";
import { describeApiError } from "../api/errors";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { Timeline } from "../ui/Timeline";
import { CraftDetailHeader, StatCard } from "./craftDetailParts";
import { buildTrackingDetail } from "./trackingDetailModel";
import type { TrackingDetail as TrackingDetailData } from "../api/types";

export interface TrackingDetailProps {
    gridId: number;
    id: number;
    onClose: () => void;
}

/**
 * Full-page tracking detail for one `trackinghistory` entry (M5) - a design deviation, decided with the
 * user: the handoff's own detail surface is a 420px drawer, which can't hold a timeline. The record is
 * immutable once it exists (only added to `trackingInfos` after `timeDone` is set) so this fetches once
 * on mount - no polling, no ticking clock.
 */
export function TrackingDetail({ gridId, id, onClose }: TrackingDetailProps) {
    const [detail, setDetail] = useState<TrackingDetailData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setDetail(null);
        setError(null);
        getTracking(gridId, id)
            .then((d) => {
                if (!cancelled) setDetail(d);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(describeApiError(e, "Couldn't load this job's tracking data"));
            });
        return () => {
            cancelled = true;
        };
    }, [gridId, id]);

    if (error) {
        return (
            <section className="craft-detail">
                <CraftDetailHeader
                    outputName="Tracking history"
                    outputQty={null}
                    subtitle="Couldn't load"
                    statusLabel="Error"
                    statusVariant="grey"
                    onClose={onClose}
                    closeTitle="Back to history"
                />
                <div className="placeholder-panel browser__error">
                    <p>{error}</p>
                    <Button variant="secondary" onClick={onClose}>
                        Back to history
                    </Button>
                </div>
            </section>
        );
    }

    if (!detail) {
        return <div className="placeholder-panel">Loading tracking data…</div>;
    }

    const view = buildTrackingDetail(detail);
    const missingItemRows = detail.items.length - view.itemTimelineRows.length;
    const missingInterfaceRows = detail.interfaceShare.length - view.interfaceTimelineRows.length;

    return (
        <section className="craft-detail">
            <CraftDetailHeader
                outputName={view.outputName}
                outputQty={view.outputQty}
                subtitle={detail.wasCancelled ? "This job was cancelled" : "Crafting history"}
                statusLabel={view.statusLabel}
                statusVariant={view.statusVariant}
                onClose={onClose}
                closeTitle="Back to history"
            />

            <section className="craft-detail__stats">
                <StatCard label="Output">
                    <FormattedText text={view.outputName} /> x{view.outputQty.toLocaleString("en-US")}
                </StatCard>
                {view.stats.map((st) => (
                    <StatCard key={st.label} label={st.label}>
                        {st.value}
                    </StatCard>
                ))}
            </section>

            {view.items.length > 0 && (
                <section className="tracking-detail__items">
                    {view.items.map((row) => (
                        <div className="craft-detail__item-card" key={row.itemid}>
                            <div className="craft-detail__item-head">
                                <FormattedText text={row.itemname} className="craft-detail__item-name" />
                            </div>
                            <div className="craft-detail__item-stats">
                                {row.stats.map((st) => (
                                    <div className="craft-detail__item-stat" key={st.label}>
                                        <span>{st.label}</span>
                                        <span>{st.value}</span>
                                    </div>
                                ))}
                            </div>
                            {row.sharePct !== null && (
                                <div className="craft-detail__share">
                                    <div className="craft-detail__share-track">
                                        <div
                                            className="craft-detail__share-fill"
                                            style={{ width: `${Math.round(row.sharePct * 100)}%` }}
                                        />
                                    </div>
                                    <span>{Math.round(row.sharePct * 100)}% of craft time</span>
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}

            <div className="tracking-detail__timeline-card">
                <span className="tracking-detail__timeline-title">Item share</span>
                {view.itemTimelineRows.length > 0 ? (
                    <Timeline rows={view.itemTimelineRows} domain={view.domain} color="purple" />
                ) : (
                    <span className="tracking-detail__timeline-more">No per-item timing recorded.</span>
                )}
                {missingItemRows > 0 && (
                    <span className="tracking-detail__timeline-more">+{missingItemRows} more not shown</span>
                )}
            </div>

            <div className="tracking-detail__timeline-card">
                <span className="tracking-detail__timeline-title">Interface share</span>
                {view.interfaceTimelineRows.length > 0 ? (
                    <Timeline rows={view.interfaceTimelineRows} domain={view.domain} color="teal" />
                ) : (
                    <span className="tracking-detail__timeline-more">No interface usage recorded.</span>
                )}
                {missingInterfaceRows > 0 && (
                    <span className="tracking-detail__timeline-more">+{missingInterfaceRows} more not shown</span>
                )}
            </div>
        </section>
    );
}
