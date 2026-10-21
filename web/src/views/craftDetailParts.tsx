// Pieces shared between the active-mode Craft Detail page, the plan preview (PlanDetail.tsx) and the
// history detail - lifted out of CraftDetail.tsx rather than duplicated, since both pages render
// the same header/stat-card/three-column shapes against `CraftDetailView`-shaped data.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { formatDuration, gtTierName, skipSpecialFormat } from "../api/format";
import type { GTMachine, ResourceRef, WorkingMachine } from "../api/types";
import { buildHash } from "../shell/route";
import type { MachineLabels } from "../state/gt";

import { Badge } from "../ui/Badge";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { ProgressBar } from "../ui/ProgressBar";
import { summarizeMachines } from "./craftMachinesModel";
import type { MachineGroupSummary, MachineMatches } from "./craftMachinesModel";
import { RecipeCountdown, useNow } from "./gtCommon";
import {
    coordsText,
    dimensionKey,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    machineLabel,
    recipeClock,
    statusDuration,
} from "./gtModel";
import { RecipeStrip } from "./RecipeFlow";
import type { ConsumedRow, CraftStepRow, StepStage, WorkingMachineRow } from "./craftDetailModel";
import { isFluidId } from "./browserModel";
import { formatResourceAmount } from "../state/craftProgress";
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

export type StepSortKey = "name" | "crafted" | "active" | "pending" | "stored" | "rate" | "time";

const STAGES: { key: StepStage; title: string; color: string }[] = [
    { key: "crafting", title: "Crafting", color: "var(--amber)" },
    { key: "waiting", title: "Waiting", color: "var(--text-muted)" },
    { key: "done", title: "Done", color: "var(--green)" },
];

function sortValue(row: CraftStepRow, key: StepSortKey): number | string {
    switch (key) {
        case "name":
            return skipSpecialFormat(row.itemname).toLowerCase();
        case "crafted":
            return row.planned > 0 ? row.crafted / row.planned : 0;
        case "rate":
            return row.rate ?? -1;
        case "time":
            return row.timeSpent;
        default:
            return row[key];
    }
}

function sortSteps(rows: CraftStepRow[], key: StepSortKey, desc: boolean): CraftStepRow[] {
    const dir = desc ? -1 : 1;
    return [...rows].sort((a, b) => {
        const va = sortValue(a, key);
        const vb = sortValue(b, key);
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
}

function formatRate(row: CraftStepRow): string {
    if (row.rate === null) return "—";
    const fixed = row.rate >= 10 ? row.rate.toFixed(0) : row.rate.toFixed(1);
    return isFluidId(row.itemid) ? `${fixed} L/s` : `${fixed}/s`;
}

export interface StepTableProps {
    steps: CraftStepRow[];
    tracked: boolean;
    groupByStage: boolean;
    /** Stage groups folded to their header. */
    hidden: StepStage[];
    onToggleStage: (stage: StepStage) => void;
    sort: { key: StepSortKey; desc: boolean };
    onSort: (key: StepSortKey) => void;
    onOpenItem?: (item: ResourceRef) => void;
}

/** Every item of the job in one sortable table, optionally grouped Crafting / Waiting / Done. */
export function StepTable({
    steps,
    tracked,
    groupByStage,
    hidden,
    onToggleStage,
    sort,
    onSort,
    onOpenItem,
}: StepTableProps) {
    const head = (label: string, key: StepSortKey, right?: boolean) => (
        <button
            type="button"
            className={cx("dtable__sort", sort.key === key && "dtable__sort--active", right && "right")}
            onClick={() => onSort(key)}
        >
            {label}
            {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
        </button>
    );
    const rows = (list: CraftStepRow[]) =>
        sortSteps(list, sort.key, sort.desc).map((row) => (
            <StepRow key={row.itemid} row={row} tracked={tracked} onOpenItem={onOpenItem} />
        ));

    return (
        <div className={cx("dtable steps", !tracked && "steps--untracked")}>
            <div className="dtable__head">
                <span />
                {head("Item", "name")}
                {head("Crafted", "crafted")}
                {head("Active", "active", true)}
                {head("Pending", "pending", true)}
                {head("Stored", "stored", true)}
                {head("Rate", "rate", true)}
                {head("Time spent", "time")}
                <span />
            </div>
            {groupByStage
                ? STAGES.map((stage) => {
                      const list = steps.filter((r) => r.stage === stage.key);
                      if (list.length === 0) return null;
                      const isHidden = hidden.includes(stage.key);
                      return (
                          <div key={stage.key} className="steps__group">
                              <div className="steps__group-head">
                                  <span className="steps__group-dot" style={{ background: stage.color }} />
                                  <span className="steps__group-title" style={{ color: stage.color }}>
                                      {stage.title}
                                  </span>
                                  <span className="mono-count">{list.length}</span>
                                  <button
                                      type="button"
                                      className="btn btn--text steps__group-toggle"
                                      onClick={() => onToggleStage(stage.key)}
                                  >
                                      {isHidden ? "Show" : "Hide"}
                                  </button>
                              </div>
                              {!isHidden && rows(list)}
                          </div>
                      );
                  })
                : rows(steps)}
        </div>
    );
}

function StepRow({
    row,
    tracked,
    onOpenItem,
}: {
    row: CraftStepRow;
    tracked: boolean;
    onOpenItem?: (item: ResourceRef) => void;
}) {
    const pct = row.planned > 0 ? Math.min(1, row.crafted / row.planned) : 0;
    const activePct = row.planned > 0 ? Math.min(1 - pct, row.active / row.planned) : 0;
    const color = row.stage === "done" ? "var(--green)" : row.stage === "waiting" ? "var(--text-dim)" : "var(--amber)";
    return (
        <div
            className={cx("dtable__row steps__row", onOpenItem && "dtable__row--clickable")}
            onClick={onOpenItem ? () => onOpenItem(row) : undefined}
            title={onOpenItem ? "Stock, history and stock rule" : undefined}
        >
            <ItemIcon itemid={row.itemid} name={row.itemname} size={22} />
            <button type="button" className="cell-text steps__name" tabIndex={onOpenItem ? 0 : -1}>
                <FormattedText text={row.itemname} />
            </button>
            <div className="steps__crafted">
                {tracked ? (
                    <>
                        <div className="bar steps__bar">
                            <div className="bar__fill" style={{ width: `${pct * 100}%`, background: color }} />
                            <div
                                className="bar__fill"
                                style={{
                                    left: `${pct * 100}%`,
                                    width: `${activePct * 100}%`,
                                    background: color,
                                    opacity: 0.35,
                                }}
                            />
                        </div>
                        <span className="steps__crafted-label">
                            {formatResourceAmount(row.itemid, row.crafted)} /{" "}
                            {formatResourceAmount(row.itemid, row.planned)}
                        </span>
                    </>
                ) : (
                    <span className="steps__crafted-label">—</span>
                )}
            </div>
            <span className={cx("cell-num", row.active > 0 && "amber")}>
                {row.active > 0 ? formatResourceAmount(row.itemid, row.active) : "—"}
            </span>
            <span className="cell-num">{row.pending > 0 ? formatResourceAmount(row.itemid, row.pending) : "—"}</span>
            <span className="cell-num dim">{row.stored > 0 ? formatResourceAmount(row.itemid, row.stored) : "—"}</span>
            <span className="cell-num dim">{formatRate(row)}</span>
            <div className="steps__time">
                <div className="steps__share">
                    <div style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }} />
                </div>
                <span>{tracked ? formatDuration(row.timeSpent) : "—"}</span>
            </div>
            <span className="steps__chevron" aria-hidden="true">
                {onOpenItem ? "›" : ""}
            </span>
        </div>
    );
}

/** Everything the job's pushed patterns used up - live while crafting and in the history record. */
export function ConsumedSection({
    rows,
    onOpenItem,
}: {
    rows: ConsumedRow[];
    /** Makes each chip open that item's detail panel. */
    onOpenItem?: (item: ResourceRef) => void;
}) {
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
                    {rows.map((row) => {
                        const Tag = onOpenItem ? "button" : "div";
                        return (
                            <Tag
                                key={row.itemid}
                                type={onOpenItem ? "button" : undefined}
                                className={cx(
                                    "craft-detail__chip",
                                    row.intermediate && "craft-detail__chip--intermediate",
                                    onOpenItem && "craft-detail__chip--link",
                                )}
                                title={row.intermediate ? "Also crafted by this job" : "Taken from storage"}
                                onClick={onOpenItem ? () => onOpenItem(row) : undefined}
                            >
                                <ItemIcon itemid={row.itemid} name={row.itemname} size={24} />
                                <FormattedText text={row.itemname} className="craft-detail__chip-name" />
                                <span className="craft-detail__chip-amount">x{row.amount}</span>
                            </Tag>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

/** GregTech data for the Working machines panel; `null` on a server without GT. */
export interface WorkingMachinesGT {
    matches: MachineMatches;
    /** The user's machine nicknames. */
    names: MachineLabels;
    scannedAt: number;
    numberFormat: "full" | "compact";
}

/** A provider card lists this many machines before folding the rest behind "+N more". */
const MACHINES_SHOWN = 4;

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

/**
 * Re-renders once a second for the status durations - only mounted while a machine matched. Recipe bars and
 * countdowns animate on their own (`ProgressBar` `cycle`, `RecipeCountdown`).
 */
function LiveWorkingMachinesPanel(props: WorkingMachinesPanelProps) {
    const now = useNow(1000);
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
                        const summary = gt && matched.length > 0 ? summarizeMachines(matched) : null;
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
    const clocks = machines.map((m) => recipeClock(m, gt.scannedAt)).filter((c) => c !== null);
    return (
        <div className="craft-detail__gt">
            <div className="craft-detail__gt-head">
                <span>
                    {summary.running}/{summary.total} running
                </span>
                {clocks.length > 0 && (
                    <span>
                        <RecipeCountdown clocks={clocks} prefix="next in " />
                    </span>
                )}
            </div>
            {shown.map((machine) => (
                <MatchedMachineRow
                    key={machine.id}
                    machine={machine}
                    gt={gt}
                    now={now}
                    withRecipe
                    withCoords={machines.some(
                        (o) => o !== machine && machineLabel(o, gt.names) === machineLabel(machine, gt.names),
                    )}
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
    const clock = recipeClock(m, gt.scannedAt);
    const variant = GT_STATUS_VARIANTS[m.status];
    const label = GT_STATUS_LABELS[m.status];
    const duration = statusDuration(m, now);
    const name = machineLabel(m, gt.names);
    const tooltip = [
        `${name} at ${coordsText(m)} (${dimensionKey(m)})`,
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
                <span className="craft-detail__gt-name">{name}</span>
                {m.voltageTier >= 0 && <span className="craft-detail__gt-tier">{gtTierName(m.voltageTier)}</span>}
                {withCoords && <span className="craft-detail__gt-coords">{coordsText(m)}</span>}
                <span className={`craft-detail__gt-state craft-detail__gt-state--${variant}`}>
                    {clock ? (
                        <RecipeCountdown clocks={[clock]} suffix=" left" />
                    ) : duration ? (
                        `${label} · ${duration}`
                    ) : (
                        label
                    )}
                </span>
            </span>
            <ProgressBar
                className="craft-detail__gt-bar"
                // A stopped machine keeps its bar where the recipe halted, in the status colour.
                percent={m.maxProgressTicks > 0 ? (m.progressTicks / m.maxProgressTicks) * 100 : 100}
                cycle={clock}
                height={4}
                color={clock ? "var(--green)" : VARIANT_COLORS[variant]}
                animated={false}
            />
            {withRecipe && (
                <RecipeStrip inputs={m.inputs} outputs={m.outputs} clock={clock} numberFormat={gt.numberFormat} />
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
