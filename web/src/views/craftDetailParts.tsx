// Pieces shared between the active-mode Craft Detail page, the plan preview (PlanDetail.tsx) and the
// history detail - lifted out of CraftDetail.tsx rather than duplicated, since both pages render
// the same header/stat-card/three-column shapes against `CraftDetailView`-shaped data.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { gtTierName } from "../api/format";
import type { GTMachine, WorkingMachine } from "../api/types";
import { buildHash } from "../shell/route";

import { Badge } from "../ui/Badge";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { ProgressBar } from "../ui/ProgressBar";
import { progressCycle, summarizeMachines } from "./craftMachinesModel";
import type { MachineGroupSummary, MachineMatches } from "./craftMachinesModel";
import { useNow } from "./gtCommon";
import {
    coordsText,
    dimensionKey,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    liveProgressTicks,
    remainingLabel,
} from "./gtModel";
import { RecipeStrip } from "./RecipeFlow";
import type { ConsumedRow, CraftDetailColumn, CraftDetailColumnKey, WorkingMachineRow } from "./craftDetailModel";
import type { BadgeVariant } from "../ui/Badge";

export interface CraftDetailHeaderProps {
    /** Shows the output's icon beside the title when given. */
    outputItemid?: string;
    outputName: string;
    outputQty: number | null;
    subtitle: string;
    statusLabel: string;
    statusVariant: BadgeVariant;
    onClose: () => void;
    closeTitle?: string;
}

export function CraftDetailHeader({
    outputItemid,
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
            {outputItemid && <ItemIcon itemid={outputItemid} name={outputName} size={40} />}
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

export interface CraftDetailColumnsProps {
    columns: CraftDetailColumn[];
    /** Columns showing only their count and a "Show" button instead of their rows. */
    collapsed?: CraftDetailColumnKey[];
    onToggleCollapsed?: (key: CraftDetailColumnKey) => void;
}

export function CraftDetailColumns({ columns, collapsed = [], onToggleCollapsed }: CraftDetailColumnsProps) {
    return (
        <section className="craft-detail__columns">
            {columns.map((col) => (
                <section className="craft-detail__column" key={col.key}>
                    <div className={`craft-detail__col-head craft-detail__col-head--${col.color}`}>
                        <span className="craft-detail__col-title">{col.title}</span>
                        <span className="craft-detail__col-count">{col.rows.length}</span>
                        {onToggleCollapsed && col.rows.length > 0 && (
                            <button
                                type="button"
                                className="craft-detail__col-toggle"
                                onClick={() => onToggleCollapsed(col.key)}
                            >
                                {collapsed.includes(col.key) ? "Show" : "Hide"}
                            </button>
                        )}
                    </div>
                    {!collapsed.includes(col.key) &&
                        col.rows.map((row) => (
                            <div className="craft-detail__item-card" key={row.itemid}>
                                <div className="craft-detail__item-head">
                                    <ItemIcon itemid={row.itemid} name={row.itemname} size={28} />
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
                                                className="craft-detail__share-fill"
                                                style={{ width: `${Math.round(row.sharePct * 100)}%` }}
                                            />
                                        </div>
                                        <span>{Math.round(row.sharePct * 100)}% of craft time</span>
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

/** Everything the job's pushed patterns used up - live while crafting and in the history record. */
export function ConsumedSection({ rows }: { rows: ConsumedRow[] }) {
    const raw = rows.filter((r) => !r.intermediate).length;
    return (
        <section className="craft-detail__panel">
            <div className="craft-detail__panel-head">
                <span className="craft-detail__panel-title">Consumed</span>
                <span className="craft-detail__panel-hint">
                    {raw} raw input{raw === 1 ? "" : "s"}
                    {rows.length > raw && `, ${rows.length - raw} crafted along the way`}
                </span>
            </div>
            {rows.length === 0 ? (
                <span className="craft-detail__panel-empty">No patterns pushed yet.</span>
            ) : (
                <div className="craft-detail__chips">
                    {rows.map((row) => (
                        <div
                            key={row.itemid}
                            className={cx("craft-detail__chip", row.intermediate && "craft-detail__chip--intermediate")}
                            title={row.intermediate ? "Also crafted by this job" : "Taken from storage"}
                        >
                            <ItemIcon itemid={row.itemid} name={row.itemname} size={24} />
                            <FormattedText text={row.itemname} className="craft-detail__chip-name" />
                            <span className="craft-detail__chip-amount">x{row.amount}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

/** GregTech data for the Working machines panel; `null` on a server without GT. */
export interface WorkingMachinesGT {
    matches: MachineMatches;
    scannedAt: number;
    numberFormat: "full" | "compact";
}

/** A provider card lists this many machines before folding the rest behind "+N more". */
const MACHINES_SHOWN = 4;
/** Groups up to this size show each machine's recipe strip too; bigger ones stay compact. */
const RECIPE_STRIP_MAX = 2;

/**
 * The pattern providers - usually named after the machine they feed - still working on this job, each
 * with the GregTech machines running its recipe (see `craftMachinesModel.ts`) when the server has GT.
 */
export function WorkingMachines({ rows, gt }: { rows: WorkingMachineRow[]; gt: WorkingMachinesGT | null }) {
    // Lifted above the live/static split so switching between them keeps what's expanded.
    const [expanded, setExpanded] = useState<ReadonlySet<WorkingMachine>>(new Set());
    const toggle = (source: WorkingMachine) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(source)) next.add(source);
            return next;
        });
    const anyMatch = gt !== null && rows.some((r) => gt.matches.has(r.source));
    const props = { rows, gt, expanded, onToggle: toggle };
    return anyMatch ? <LiveWorkingMachinesPanel {...props} /> : <WorkingMachinesPanel {...props} now={0} />;
}

interface WorkingMachinesPanelProps {
    rows: WorkingMachineRow[];
    gt: WorkingMachinesGT | null;
    expanded: ReadonlySet<WorkingMachine>;
    onToggle: (source: WorkingMachine) => void;
}

/** Re-renders 4x a second so recipe progress bars move smoothly - only mounted while a machine matched. */
function LiveWorkingMachinesPanel(props: WorkingMachinesPanelProps) {
    const now = useNow(250);
    return <WorkingMachinesPanel {...props} now={now} />;
}

function WorkingMachinesPanel({ rows, gt, expanded, onToggle, now }: WorkingMachinesPanelProps & { now: number }) {
    const machineCount = gt ? rows.reduce((n, r) => n + (gt.matches.get(r.source)?.length ?? 0), 0) : 0;
    return (
        <section className="craft-detail__panel">
            <div className="craft-detail__panel-head">
                <span className="craft-detail__panel-title">Working machines</span>
                <span className="craft-detail__panel-hint">
                    {rows.length} busy
                    {machineCount > 0 && ` · ${machineCount} GregTech machine${machineCount === 1 ? "" : "s"}`}
                </span>
            </div>
            {rows.length === 0 ? (
                <span className="craft-detail__panel-empty">No pattern is out at a machine right now.</span>
            ) : (
                <div className={cx("craft-detail__machines", machineCount > 0 && "craft-detail__machines--gt")}>
                    {rows.map((m, i) => {
                        const matched = gt?.matches.get(m.source) ?? [];
                        const summary = gt && matched.length > 0 ? summarizeMachines(matched, gt.scannedAt, now) : null;
                        return (
                            <div
                                key={`${m.name}:${i}`}
                                className={cx(
                                    "craft-detail__machine",
                                    summary?.problem && `craft-detail__machine--${summary.problem}`,
                                    summary && !summary.problem && "craft-detail__machine--running",
                                )}
                            >
                                <div className="craft-detail__machine-head">
                                    <span className="craft-detail__machine-name">{m.name}</span>
                                    <span className="craft-detail__machine-running">{m.running}</span>
                                </div>
                                <span className="craft-detail__machine-location">{m.location}</span>
                                <div className="craft-detail__machine-items">
                                    {m.items.map((item) => (
                                        <ItemIcon
                                            key={item.itemid}
                                            itemid={item.itemid}
                                            name={item.itemname}
                                            size={22}
                                        />
                                    ))}
                                </div>
                                {gt && summary && (
                                    <MatchedMachineList
                                        machines={matched}
                                        summary={summary}
                                        gt={gt}
                                        now={now}
                                        expanded={expanded.has(m.source)}
                                        onToggle={() => onToggle(m.source)}
                                    />
                                )}
                                {gt && !summary && (
                                    <span className="craft-detail__gt-none">No GregTech machine matched</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function MatchedMachineList({
    machines,
    summary,
    gt,
    now,
    expanded,
    onToggle,
}: {
    machines: GTMachine[];
    summary: MachineGroupSummary;
    gt: WorkingMachinesGT;
    now: number;
    expanded: boolean;
    onToggle: () => void;
}) {
    const shown = expanded || machines.length <= MACHINES_SHOWN ? machines : machines.slice(0, MACHINES_SHOWN - 1);
    const hidden = machines.length - shown.length;
    return (
        <div className="craft-detail__gt">
            <div className="craft-detail__gt-head">
                <span>
                    {summary.running}/{summary.total} running
                </span>
                {summary.nextSeconds !== null && <span>next in {formatSeconds(summary.nextSeconds)}</span>}
            </div>
            {shown.map((machine) => (
                <MatchedMachineRow
                    key={machine.id}
                    machine={machine}
                    gt={gt}
                    now={now}
                    withRecipe={machines.length <= RECIPE_STRIP_MAX}
                    withCoords={machines.some((o) => o !== machine && o.name === machine.name)}
                />
            ))}
            {(hidden > 0 || (expanded && machines.length > MACHINES_SHOWN)) && (
                <button type="button" className="craft-detail__gt-more" onClick={onToggle}>
                    {hidden > 0 ? `+${hidden} more` : "Show fewer"}
                </button>
            )}
        </div>
    );
}

function MatchedMachineRow({
    machine: m,
    gt,
    now,
    withRecipe,
    withCoords,
}: {
    machine: GTMachine;
    gt: WorkingMachinesGT;
    now: number;
    withRecipe: boolean;
    /** Another machine in the group has the same name - the coordinates tell them apart. */
    withCoords: boolean;
}) {
    const running = m.status === "RUNNING" && m.maxProgressTicks > 0;
    const progress = liveProgressTicks(m, gt.scannedAt, now);
    const variant = GT_STATUS_VARIANTS[m.status];
    const label = GT_STATUS_LABELS[m.status];
    const tooltip = [
        `${m.name} at ${coordsText(m)} (${dimensionKey(m)})`,
        m.statusDetail && m.statusDetail.toLowerCase() !== label.toLowerCase() ? m.statusDetail : null,
        "Open in Machines",
    ]
        .filter(Boolean)
        .join("\n");
    return (
        <a
            className="craft-detail__gt-row"
            href={buildHash({ section: "machines", grid: null, detail: { type: "machine", id: m.id }, item: null })}
            title={tooltip}
        >
            <span className="craft-detail__gt-line">
                <span className={`craft-detail__gt-dot craft-detail__gt-dot--${variant}`} aria-hidden="true" />
                <span className="craft-detail__gt-name">{m.name}</span>
                {m.voltageTier >= 0 && <span className="craft-detail__gt-tier">{gtTierName(m.voltageTier)}</span>}
                {withCoords && <span className="craft-detail__gt-coords">{coordsText(m)}</span>}
                <span className={`craft-detail__gt-state craft-detail__gt-state--${variant}`}>
                    {running ? remainingLabel(m, progress) : label}
                </span>
            </span>
            <ProgressBar
                // A new key per recipe pass, so the bar restarts from 0 instead of sliding backwards.
                key={progressCycle(m, gt.scannedAt, now)}
                className="craft-detail__gt-bar"
                // A stopped machine keeps its bar where the recipe halted, in the status colour.
                percent={m.maxProgressTicks > 0 ? (progress / m.maxProgressTicks) * 100 : 100}
                height={4}
                color={running ? "var(--green)" : VARIANT_COLORS[variant]}
            />
            {withRecipe && (
                <RecipeStrip
                    inputs={m.inputs}
                    outputs={m.outputs}
                    progress={running ? progress / m.maxProgressTicks : 0}
                    numberFormat={gt.numberFormat}
                />
            )}
        </a>
    );
}

const VARIANT_COLORS: Record<BadgeVariant, string> = {
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
    grey: "var(--text-muted)",
    teal: "var(--teal)",
    purple: "var(--accent)",
};

/** `"4s"` / `"2m 5s"`. */
function formatSeconds(seconds: number): string {
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
