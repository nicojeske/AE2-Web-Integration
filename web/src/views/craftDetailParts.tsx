// Pieces shared between the active-mode Craft Detail page (M3) and the plan-mode Craft Detail page
// (M4, PlanDetail.tsx) - lifted out of CraftDetail.tsx rather than duplicated, since both pages render
// the same header/stat-card/three-column shapes against `CraftDetailView`-shaped data.
import type { ComponentChildren } from "preact";

import { Badge } from "../ui/Badge";
import { FormattedText } from "../ui/FormattedText";
import type { CraftDetailColumn } from "./craftDetailModel";
import type { BadgeVariant } from "../ui/Badge";

export interface CraftDetailHeaderProps {
    outputName: string;
    outputQty: number | null;
    subtitle: string;
    statusLabel: string;
    statusVariant: BadgeVariant;
    onClose: () => void;
    closeTitle?: string;
}

export function CraftDetailHeader({
    outputName,
    outputQty,
    subtitle,
    statusLabel,
    statusVariant,
    onClose,
    closeTitle = "Back to jobs",
}: CraftDetailHeaderProps) {
    return (
        <section className="craft-detail__header">
            <button type="button" className="craft-detail__back" title={closeTitle} onClick={onClose}>
                ←
            </button>
            <div className="craft-detail__heading">
                <span className="craft-detail__title">
                    {outputQty === null ? outputName : <FormattedText text={outputName} />}
                    {outputQty !== null && ` x${outputQty.toLocaleString("en-US")}`}
                </span>
                <span className="craft-detail__subtitle">{subtitle}</span>
            </div>
            <Badge variant={statusVariant} size="md">
                {statusLabel}
            </Badge>
        </section>
    );
}

export function StatCard({ label, children }: { label: string; children: ComponentChildren }) {
    return (
        <div className="craft-detail__stat-card">
            <span className="craft-detail__stat-label">{label}</span>
            <span className="craft-detail__stat-value">{children}</span>
        </div>
    );
}

export function CraftDetailColumns({ columns }: { columns: CraftDetailColumn[] }) {
    return (
        <section className="craft-detail__columns">
            {columns.map((col) => (
                <section className="craft-detail__column" key={col.key}>
                    <div className={`craft-detail__col-head craft-detail__col-head--${col.color}`}>
                        <span className="craft-detail__col-title">{col.title}</span>
                        <span className="craft-detail__col-count">{col.rows.length}</span>
                    </div>
                    {col.rows.map((row) => (
                        <div className="craft-detail__item-card" key={row.itemid}>
                            <div className="craft-detail__item-head">
                                <FormattedText text={row.itemname} className="craft-detail__item-name" />
                                <span className={`craft-detail__item-badge craft-detail__item-badge--${col.color}`}>
                                    {row.badgeText}
                                </span>
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
                                            // Always purple (M3's active-mode share, verified), except the
                                            // plan page's teal "From storage" column - no other plan column
                                            // ever produces a sharePct (Job.java only sets `usedPercent` for
                                            // from-storage rows), so this doesn't need a rule per column color.
                                            className={`craft-detail__share-fill${col.color === "teal" ? " craft-detail__share-fill--teal" : ""}`}
                                            style={{ width: `${Math.round(row.sharePct * 100)}%` }}
                                        />
                                    </div>
                                    <span>
                                        {Math.round(row.sharePct * 100)}% {row.shareCaption ?? "of craft time"}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                    {col.rows.length === 0 && <div className="craft-detail__col-empty">{col.emptyText}</div>}
                </section>
            ))}
        </section>
    );
}
