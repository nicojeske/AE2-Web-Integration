// GregTech Production section (docs/gt-hub/phase-2-frontend.md §4.3): what GT multiblocks produced over
// a range, grouped by item, machine or processing line, each row expandable into its breakdown and a per-window
// chart - or, for a line, its machines' output and how they spent the range.
// An item row links to its stock history in Statistics, since `/gt/*` item ids match AE2's `itemid`.
import { useMemo, useState } from "preact/hooks";

import { getGTMachineStates, getGTProduction, getGTProductionHistory } from "../api/client";
import { formatTimestamp } from "../api/format";
import type { GTFlow, GTMachine, GTProduction, GTProductionEntry, GTRange } from "../api/types";
import { GT_PRODUCTION_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { MAX_PINNED, useStats } from "../state/stats";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { cx } from "../ui/cx";
import { FactoryIcon } from "../ui/icons";
import { ItemIcon } from "../ui/ItemIcon";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { CustomRangeInput } from "./CustomRangeInput";
import { machineVerdicts } from "./bottlenecksModel";
import { GTPollState, StateSplitBar } from "./gtCommon";
import {
    aggregateLines,
    formatGTAmount,
    formatGTPerHour,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    gtRangeOptions,
    lineHealth,
    lineHealthText,
    lineMemberIds,
} from "./gtModel";
import type { LineHealth, LineProductionEntry } from "./gtModel";
import { DEFAULT_CUSTOM_MINUTES, pointTimestamps } from "./statsModel";

/** `"line"` is the user's processing lines, summed client-side from the server's per-machine rows. */
type GroupBy = "item" | "machine" | "line";
type Kind = "all" | "items" | "fluids";

const RANGES = gtRangeOptions(["1h", "6h", "24h", "7d", "30d", "90d", "custom"]);
const GROUP_OPTIONS: SegmentedOption<GroupBy>[] = [
    { value: "item", label: "Items" },
    { value: "machine", label: "Machines" },
    { value: "line", label: "Lines" },
];
const FLOW_OPTIONS: SegmentedOption<GTFlow>[] = [
    { value: "produced", label: "Produced" },
    { value: "consumed", label: "Consumed" },
];
const KIND_OPTIONS: SegmentedOption<Kind>[] = [
    { value: "all", label: "All" },
    { value: "items", label: "Items" },
    { value: "fluids", label: "Fluids" },
];
const SEARCH_PLACEHOLDERS: Record<Kind, string> = {
    all: "Search items and fluids...",
    items: "Search items...",
    fluids: "Search fluids...",
};
const HOUR = 3_600_000;

/**
 * Only the rows of one kind. Machine rows mix items and fluids, so each keeps just the matching entries of
 * its breakdown, with its totals summed again from them; a machine left with none drops out.
 */
function filterByKind(rows: GTProductionEntry[], groupBy: "item" | "machine", kind: Kind): GTProductionEntry[] {
    if (kind === "all") return rows;
    const wanted = (e: GTProductionEntry) => e.fluid === (kind === "fluids");
    if (groupBy === "item") return rows.filter(wanted);
    return rows
        .map((row) => {
            const breakdown = row.breakdown.filter(wanted);
            const total = breakdown.reduce((sum, b) => sum + b.total, 0);
            const perHour = breakdown.reduce((sum, b) => sum + b.perHour, 0);
            return { ...row, breakdown, total, perHour };
        })
        .filter((row) => row.breakdown.length > 0)
        .sort((a, b) => b.total - a.total);
}

export interface ProductionProps {
    onOpenMachine: (id: string) => void;
    /** Navigates to Statistics on the currently selected network. */
    onOpenStats: () => void;
}

export function Production({ onOpenMachine, onOpenStats }: ProductionProps) {
    const { nonce, machineLines } = useGT();
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);
    const [chosenGroupBy, setGroupBy] = useState<GroupBy>("item");
    // Lines only exist once the user puts machines on one (Machines tab), so the option hides until then.
    const hasLines = Object.keys(machineLines).length > 0;
    const groupBy = chosenGroupBy === "line" && !hasLines ? "machine" : chosenGroupBy;
    const serverGroupBy = groupBy === "line" ? "machine" : groupBy;
    const [flow, setFlow] = useState<GTFlow>("produced");
    const [kind, setKind] = useState<Kind>("all");
    const [search, setSearch] = useState("");
    const minutes = range === "custom" ? customMinutes : undefined;
    const production = useGTPoll(
        () => getGTProduction(range, serverGroupBy, flow, undefined, minutes),
        GT_PRODUCTION_POLL_MS,
        `${range}|${serverGroupBy}|${flow}|${minutes ?? ""}`,
        nonce,
    );

    return (
        <div className="page">
            <div className="page__main">
                <header className="page-header">
                    <h2 className="page-header__title">Production</h2>
                    <SegmentedControl<GTRange>
                        className="segmented--mono"
                        options={RANGES}
                        value={range}
                        onChange={setRange}
                    />
                    {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
                    <SegmentedControl<GroupBy>
                        className="segmented--mono"
                        options={hasLines ? GROUP_OPTIONS : GROUP_OPTIONS.filter((o) => o.value !== "line")}
                        value={groupBy}
                        onChange={setGroupBy}
                    />
                    <SegmentedControl<GTFlow>
                        className="segmented--mono"
                        options={FLOW_OPTIONS}
                        value={flow}
                        onChange={setFlow}
                    />
                    <SegmentedControl<Kind>
                        className="segmented--mono"
                        options={KIND_OPTIONS}
                        value={kind}
                        onChange={setKind}
                    />
                    <input
                        type="text"
                        className="field production__search"
                        placeholder={
                            groupBy === "item"
                                ? SEARCH_PLACEHOLDERS[kind]
                                : groupBy === "line"
                                  ? "Search lines..."
                                  : "Search machines..."
                        }
                        value={search}
                        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                    />
                </header>
                <div className="page__scroll">
                    <GTPollState poll={production} what="production">
                        {(data) => (
                            <ProductionTable
                                data={data}
                                lines={groupBy === "line"}
                                range={range}
                                minutes={minutes}
                                kind={kind}
                                search={search}
                                onOpenMachine={onOpenMachine}
                                onOpenStats={onOpenStats}
                            />
                        )}
                    </GTPollState>
                </div>
            </div>
        </div>
    );
}

function ProductionTable({
    data,
    lines,
    range,
    minutes,
    kind,
    search,
    onOpenMachine,
    onOpenStats,
}: {
    data: GTProduction;
    /** Sum the per-machine rows by processing line. */
    lines: boolean;
    range: GTRange;
    minutes: number | undefined;
    kind: Kind;
    search: string;
    onOpenMachine: (id: string) => void;
    onOpenStats: () => void;
}) {
    const { settings } = usePrefs();
    const { machines, machineNames, machineLines } = useGT();
    const [expanded, setExpanded] = useState<string | null>(null);
    // Until a regrouped poll lands, `data` may still hold the other grouping - render what it really holds.
    const groupBy: GroupBy = lines && data.groupBy === "machine" ? "line" : data.groupBy;
    const kindRows = useMemo(() => {
        const byKind = filterByKind(data.rows, data.groupBy, kind);
        // Machine names appear as rows (by machine or line) or breakdown entries (by item) - show the user's nicknames.
        const nick = (e: GTProductionEntry) => (machineNames[e.key] ? { ...e, name: machineNames[e.key]! } : e);
        if (groupBy === "line") return aggregateLines(byKind.map(nick), machineLines);
        return groupBy === "machine"
            ? byKind.map(nick)
            : byKind.map((row) => ({ ...row, breakdown: row.breakdown.map(nick) }));
    }, [data.rows, data.groupBy, groupBy, kind, machineLines, machineNames]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? kindRows.filter((r) => r.name.toLowerCase().includes(q) || r.key.includes(q)) : kindRows;
    }, [kindRows, search]);
    // Each line's live health from the app-wide machines poll, over every machine on it, producing or not.
    const liveById = useMemo(() => new Map((machines.data?.machines ?? []).map((m) => [m.id, m])), [machines.data]);
    const healthByLine = useMemo(() => {
        const out = new Map<string, LineHealth>();
        if (groupBy !== "line") return out;
        for (const row of kindRows) {
            if (row.key === "") continue;
            const members = lineMemberIds(machineLines, row.key)
                .map((id) => liveById.get(id))
                .filter((m): m is GTMachine => m !== undefined);
            out.set(row.key, lineHealth(members));
        }
        return out;
    }, [groupBy, kindRows, machineLines, liveById]);
    const fmt = settings.numberFormat;
    // Share bars are relative to the top row of the shown kind, not of the searched list, so a search
    // doesn't make a minor output look like the biggest one. Items and fluids aren't comparable units,
    // so each kind is scaled against its own largest row.
    const maxTotal = (fluid: boolean) => Math.max(1, ...kindRows.filter((r) => r.fluid === fluid).map((r) => r.total));

    const countingSince = data.trackingSince > data.from;

    return (
        <>
            {data.rows.length === 0 ? (
                <div className="placeholder-panel">
                    {data.flow === "consumed"
                        ? "No recipe inputs recorded in this range yet."
                        : "Nothing produced in this range yet."}
                </div>
            ) : kindRows.length === 0 ? (
                <div className="placeholder-panel">No {kind === "fluids" ? "fluid" : "item"} rows in this range.</div>
            ) : rows.length === 0 ? (
                <div className="placeholder-panel">No rows match "{search}".</div>
            ) : (
                <div className="dtable prod-table">
                    <div className="dtable__head">
                        <span />
                        <span />
                        <span>
                            {groupBy === "machine"
                                ? "Machine"
                                : groupBy === "line"
                                  ? "Line"
                                  : data.flow === "consumed"
                                    ? "Input"
                                    : "Output"}
                        </span>
                        <span className="prod-table__share-head">Share</span>
                        <span className="right">Total ↓</span>
                        <span className="right">Per hour</span>
                        <span />
                    </div>
                    {rows.map((row) => (
                        <ProductionRow
                            key={row.key}
                            row={row}
                            groupBy={groupBy}
                            flow={data.flow}
                            share={row.total / maxTotal(row.fluid)}
                            health={healthByLine.get(row.key)}
                            liveById={liveById}
                            expanded={expanded === row.key}
                            onToggle={() => setExpanded((e) => (e === row.key ? null : row.key))}
                            range={range}
                            minutes={minutes}
                            numberFormat={fmt}
                            onOpenMachine={onOpenMachine}
                            onOpenStats={onOpenStats}
                        />
                    ))}
                </div>
            )}
            <p className="production__footer">
                {countingSince && `Counting since ${formatTimestamp(data.trackingSince)}. `}
                {data.spanMillis < HOUR && "Rates over less than an hour are still settling. "}
                {data.resolution === "daily" && "Whole days - the first day may include hours before the range."}
            </p>
        </>
    );
}

function ProductionRow({
    row,
    groupBy,
    flow,
    share,
    health,
    liveById,
    expanded,
    onToggle,
    range,
    minutes,
    numberFormat,
    onOpenMachine,
    onOpenStats,
}: {
    row: GTProductionEntry;
    groupBy: GroupBy;
    flow: GTFlow;
    share: number;
    /** Line rows only: the live state of the line's machines. */
    health: LineHealth | undefined;
    liveById: Map<string, GTMachine>;
    expanded: boolean;
    onToggle: () => void;
    range: GTRange;
    minutes: number | undefined;
    numberFormat: "full" | "compact";
    onOpenMachine: (id: string) => void;
    onOpenStats: () => void;
}) {
    const isItem = groupBy === "item";
    // Machine rows carry no single unit (a machine can output items and fluids), so their totals are
    // shown as plain counts - their breakdown has the units.
    const amount = (e: GTProductionEntry) => formatGTAmount(e.total, e.fluid, numberFormat);
    const actions =
        isItem && !row.fluid ? (
            <StockHistoryButton itemid={row.key} onOpenStats={onOpenStats} />
        ) : groupBy === "machine" ? (
            <Button variant="text" onClick={() => onOpenMachine(row.key)}>
                Open
            </Button>
        ) : null;

    return (
        <>
            <div
                className={cx("dtable__row dtable__row--clickable prod-row", expanded && "prod-row--open")}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={onToggle}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle();
                    }
                }}
            >
                <span className="prod-row__caret">{expanded ? "▾" : "▸"}</span>
                {isItem ? (
                    <ItemIcon itemid={row.key} name={row.name} size={22} />
                ) : (
                    <FactoryIcon size={18} className="prod-row__machine-icon" />
                )}
                <span className="cell-text">
                    {row.name}
                    {health && <LineHealthSummary health={health} />}
                </span>
                <div className="prod-row__share">
                    <div
                        style={{
                            width: `${Math.max(1, share * 100)}%`,
                            background: row.fluid ? "var(--cyan)" : "var(--accent)",
                        }}
                    />
                </div>
                <span className="cell-num prod-row__total">{amount(row)}</span>
                <span className="cell-num dim">{formatGTPerHour(row.perHour, row.fluid, numberFormat)}</span>
                {/* Below 768px this column is hidden and the same actions sit in the expanded detail. */}
                <span className="prod-row__actions" onClick={(e) => e.stopPropagation()}>
                    {actions}
                </span>
            </div>
            {expanded && (
                <div className="prod-detail">
                    <ProductionDetail
                        row={row}
                        groupBy={groupBy}
                        flow={flow}
                        range={range}
                        minutes={minutes}
                        numberFormat={numberFormat}
                        liveById={liveById}
                        onOpenMachine={onOpenMachine}
                    />
                    {actions && <div className="production__detail-actions">{actions}</div>}
                </div>
            )}
        </>
    );
}

const DETAIL_CHART_W = 600;
const DETAIL_POINTS = 48;

function ProductionDetail({
    row,
    groupBy,
    flow,
    range,
    minutes,
    numberFormat,
    liveById,
    onOpenMachine,
}: {
    row: GTProductionEntry;
    groupBy: GroupBy;
    flow: GTFlow;
    range: GTRange;
    minutes: number | undefined;
    numberFormat: "full" | "compact";
    liveById: Map<string, GTMachine>;
    onOpenMachine: (id: string) => void;
}) {
    const isItem = groupBy === "item";
    return (
        <div className={cx("production__detail", groupBy === "line" && "production__detail--line")}>
            <div className="production__breakdown">
                <span className="section-label">
                    {isItem ? "By machine" : flow === "consumed" ? "By input" : "By output"}
                </span>
                {row.breakdown.map((b) => (
                    <div key={b.key} className="production__breakdown-row">
                        {isItem ? (
                            <button type="button" className="production__link" onClick={() => onOpenMachine(b.key)}>
                                {b.name}
                            </button>
                        ) : (
                            <span className="gt-table__item">
                                <ItemIcon itemid={b.key} name={b.name} size={18} />
                                {b.name}
                            </span>
                        )}
                        <span className="cell-num">{formatGTAmount(b.total, b.fluid || row.fluid, numberFormat)}</span>
                        <span className="cell-num dim">
                            {formatGTPerHour(b.perHour, b.fluid || row.fluid, numberFormat)}/h
                        </span>
                    </div>
                ))}
            </div>
            {groupBy === "line" ? (
                <div className="production__line-side">
                    {/* "Unassigned" isn't a line the server knows, so it has no history of its own. */}
                    {row.key !== "" && (
                        <ProductionChart
                            row={row}
                            groupBy={groupBy}
                            flow={flow}
                            range={range}
                            minutes={minutes}
                            numberFormat={numberFormat}
                        />
                    )}
                    <LineMachines
                        row={row as LineProductionEntry}
                        flow={flow}
                        range={range}
                        minutes={minutes}
                        numberFormat={numberFormat}
                        liveById={liveById}
                        onOpenMachine={onOpenMachine}
                    />
                </div>
            ) : (
                <ProductionChart
                    row={row}
                    groupBy={groupBy}
                    flow={flow}
                    range={range}
                    minutes={minutes}
                    numberFormat={numberFormat}
                />
            )}
        </div>
    );
}

/** `"4 machines · 3 running · 1 no power · 2.1k EU/t"` after a line's name, led by its worst status. */
function LineHealthSummary({ health }: { health: LineHealth }) {
    const count = health.counts.reduce((n, [, c]) => n + c, 0);
    const text = `${count === 1 ? "1 machine" : `${count} machines`}${health.counts.length > 0 || health.euPerTick !== 0 ? ` · ${lineHealthText(health)}` : ""}`;
    return (
        <span className="prod-row__line-health" title={text}>
            {health.worst && (
                <span
                    className={`machines__dot machines__dot--${GT_STATUS_VARIANTS[health.worst]}`}
                    title={GT_STATUS_LABELS[health.worst]}
                />
            )}
            {text}
        </span>
    );
}

/**
 * A line's machines: what each one put out over the range (largest first, then the members that put out nothing)
 * and how it spent the range. The time split comes from `/gt/machine-states`, which needs the history database -
 * without it only the output columns show.
 */
function LineMachines({
    row,
    flow,
    range,
    minutes,
    numberFormat,
    liveById,
    onOpenMachine,
}: {
    row: LineProductionEntry;
    flow: GTFlow;
    range: GTRange;
    minutes: number | undefined;
    numberFormat: "full" | "compact";
    liveById: Map<string, GTMachine>;
    onOpenMachine: (id: string) => void;
}) {
    const { nonce, machineNames, machineLines } = useGT();
    const states = useGTPoll(
        () => getGTMachineStates(range, minutes),
        GT_PRODUCTION_POLL_MS,
        `${range}|${minutes ?? ""}`,
        nonce,
    );
    const stateById = useMemo(() => new Map((states.data ?? []).map((m) => [m.id, m])), [states.data]);
    const members = useMemo(() => {
        const producing = new Set(row.machines.map((m) => m.key));
        // "Unassigned" isn't a line the user built, so it lists only the machines that produced something.
        const idle = row.key === "" ? [] : lineMemberIds(machineLines, row.key).filter((id) => !producing.has(id));
        return [
            ...row.machines.map((m) => ({ id: m.key, name: m.name, output: m as GTProductionEntry | null })),
            ...idle
                .map((id) => ({ id, name: machineNames[id] ?? liveById.get(id)?.name ?? id, output: null }))
                .sort((a, b) => a.name.localeCompare(b.name)),
        ];
    }, [row, machineLines, machineNames, liveById]);
    const withStates = states.data !== null;
    const outputs = flow === "consumed" ? "Took" : "Made";

    return (
        <div className="production__chart">
            <span className="section-label">Machines</span>
            <div className={cx("dtable prod-line-machines", !withStates && "prod-line-machines--no-states")}>
                <div className="dtable__head">
                    <span>Machine</span>
                    {withStates && <span>Time split</span>}
                    {withStates && <span className="right">Running</span>}
                    <span className="right">Total</span>
                    <span className="right">Per hour</span>
                    {withStates && <span />}
                </div>
                {members.map(({ id, name, output }) => {
                    const st = stateById.get(id);
                    const top = output?.breakdown
                        .slice(0, 3)
                        .map((b) => `${b.name} ${formatGTAmount(b.total, b.fluid, numberFormat)}`)
                        .join(", ");
                    return (
                        <div
                            key={id}
                            className="dtable__row prod-line-machines__row"
                            title={top ? `${outputs}: ${top}` : undefined}
                        >
                            <button
                                type="button"
                                className="production__link cell-text"
                                onClick={() => onOpenMachine(id)}
                            >
                                {name}
                            </button>
                            {withStates && (st ? <StateSplitBar machine={st} /> : <span className="dim">—</span>)}
                            {withStates && (
                                <span className="cell-num">{st ? `${Math.round(st.runningShare * 100)}%` : "—"}</span>
                            )}
                            <span className="cell-num">
                                {output ? formatGTAmount(output.total, false, numberFormat) : "—"}
                            </span>
                            <span className="cell-num dim">
                                {output ? formatGTPerHour(output.perHour, false, numberFormat) : "—"}
                            </span>
                            {withStates && (
                                <span className="bn-row__flags">
                                    {st &&
                                        machineVerdicts(st).map((v) => (
                                            <span key={v.label} title={v.title}>
                                                <Badge variant={v.variant} size="sm">
                                                    {v.label}
                                                </Badge>
                                            </span>
                                        ))}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ProductionChart({
    row,
    groupBy,
    flow,
    range,
    minutes,
    numberFormat,
}: {
    row: GTProductionEntry;
    groupBy: GroupBy;
    flow: GTFlow;
    range: GTRange;
    minutes: number | undefined;
    numberFormat: "full" | "compact";
}) {
    const { nonce } = useGT();
    const isItem = groupBy === "item";
    // The history endpoint has no kind filter, so a machine's or line's chart shows its combined output even
    // when the table above shows only its items or fluids.
    const history = useGTPoll(
        () =>
            getGTProductionHistory({
                item: isItem ? row.key : undefined,
                machine: groupBy === "machine" ? row.key : undefined,
                line: groupBy === "line" ? row.key : undefined,
                flow,
                range,
                points: DETAIL_POINTS,
                minutes,
            }),
        GT_PRODUCTION_POLL_MS,
        `${groupBy}|${flow}|${row.key}|${range}|${minutes ?? ""}`,
        nonce,
    );
    const data = history.data;
    const verb = flow === "consumed" ? "Consumed" : "Produced";
    const timestamps = data ? pointTimestamps(data.from, data.stepMillis, data.points.length) : [];

    return (
        <div className="production__chart">
            <span className="section-label">
                {verb} per {data ? describeStep(data.stepMillis) : "window"}
            </span>
            {history.error && <span className="item-panel__empty">Couldn't load ({history.error}).</span>}
            {data && (
                <Chart
                    variant="bars"
                    values={data.points}
                    timestamps={timestamps}
                    range={range}
                    spanMillis={data.to - data.from}
                    width={DETAIL_CHART_W}
                    height={110}
                    showAxes
                    numberFormat={numberFormat}
                    formatValue={isItem && row.fluid ? (v) => formatGTAmount(v, true, numberFormat) : undefined}
                    ariaLabel={`${row.name}, ${verb.toLowerCase()} per window`}
                />
            )}
        </div>
    );
}

function describeStep(stepMillis: number): string {
    if (stepMillis % (24 * HOUR) === 0) {
        const days = stepMillis / (24 * HOUR);
        return days === 1 ? "day" : `${days} days`;
    }
    const hours = stepMillis / HOUR;
    return hours === 1 ? "hour" : `${hours} hours`;
}

/** Opens this item's stock history in Statistics on the selected network, pinning it there first. */
function StockHistoryButton({ itemid, onOpenStats }: { itemid: string; onOpenStats: () => void }) {
    const { selected, selectedGrid } = useNetwork();
    const { pinned, pin } = useStats();

    if (selected === "all" || !selectedGrid) {
        return (
            <span title="Statistics is per-network - pick a single network to compare with stock history">
                <Button variant="text" disabled>
                    Stock history
                </Button>
            </span>
        );
    }
    const full = !pinned.includes(itemid) && pinned.length >= MAX_PINNED;
    return (
        <Button
            variant="text"
            disabled={full}
            title={full ? `Statistics already shows ${MAX_PINNED} pinned items - unpin one first` : undefined}
            onClick={() => {
                pin(itemid);
                onOpenStats();
            }}
        >
            Stock history
        </Button>
    );
}
