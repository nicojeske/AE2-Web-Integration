// GregTech Production section (docs/gt-hub/phase-2-frontend.md §4.3): what GT multiblocks produced over
// a range, grouped by item or by machine, each row expandable into its breakdown and a per-window chart.
// An item row links to its stock history in Statistics, since `/gt/*` item ids match AE2's `itemid`.
import { useMemo, useState } from "preact/hooks";

import { getGTProduction, getGTProductionHistory } from "../api/client";
import { formatTimestamp } from "../api/format";
import type { GTFlow, GTProduction, GTProductionEntry, GTRange } from "../api/types";
import { GT_PRODUCTION_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { MAX_PINNED, useStats } from "../state/stats";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { cx } from "../ui/cx";
import { FactoryIcon } from "../ui/icons";
import { ItemIcon } from "../ui/ItemIcon";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { CustomRangeInput } from "./CustomRangeInput";
import { GTPollState } from "./gtCommon";
import { formatGTAmount, formatGTPerHour, gtRangeOptions } from "./gtModel";
import { DEFAULT_CUSTOM_MINUTES, pointTimestamps } from "./statsModel";

type GroupBy = "item" | "machine";
type Kind = "all" | "items" | "fluids";

const RANGES = gtRangeOptions(["1h", "6h", "24h", "7d", "30d", "90d", "custom"]);
const GROUP_OPTIONS: SegmentedOption<GroupBy>[] = [
    { value: "item", label: "Items" },
    { value: "machine", label: "Machines" },
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
function filterByKind(rows: GTProductionEntry[], groupBy: GroupBy, kind: Kind): GTProductionEntry[] {
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
    const { nonce } = useGT();
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);
    const [groupBy, setGroupBy] = useState<GroupBy>("item");
    const [flow, setFlow] = useState<GTFlow>("produced");
    const [kind, setKind] = useState<Kind>("all");
    const [search, setSearch] = useState("");
    const minutes = range === "custom" ? customMinutes : undefined;
    const production = useGTPoll(
        () => getGTProduction(range, groupBy, flow, undefined, minutes),
        GT_PRODUCTION_POLL_MS,
        `${range}|${groupBy}|${flow}|${minutes ?? ""}`,
        nonce,
    );

    return (
        <section className="production">
            <div className="production__controls">
                <SegmentedControl<GTRange> options={RANGES} value={range} onChange={setRange} />
                {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
                <SegmentedControl<GroupBy> options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
                <SegmentedControl<GTFlow> options={FLOW_OPTIONS} value={flow} onChange={setFlow} />
                <SegmentedControl<Kind> options={KIND_OPTIONS} value={kind} onChange={setKind} />
                <input
                    type="text"
                    className="gt-input production__search"
                    placeholder={groupBy === "item" ? SEARCH_PLACEHOLDERS[kind] : "Search machines..."}
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
            </div>
            <GTPollState poll={production} what="production">
                {(data) => (
                    <ProductionTable
                        data={data}
                        range={range}
                        minutes={minutes}
                        kind={kind}
                        search={search}
                        onOpenMachine={onOpenMachine}
                        onOpenStats={onOpenStats}
                    />
                )}
            </GTPollState>
        </section>
    );
}

function ProductionTable({
    data,
    range,
    minutes,
    kind,
    search,
    onOpenMachine,
    onOpenStats,
}: {
    data: GTProduction;
    range: GTRange;
    minutes: number | undefined;
    kind: Kind;
    search: string;
    onOpenMachine: (id: string) => void;
    onOpenStats: () => void;
}) {
    const { settings } = usePrefs();
    const [expanded, setExpanded] = useState<string | null>(null);
    const kindRows = useMemo(() => filterByKind(data.rows, data.groupBy, kind), [data.rows, data.groupBy, kind]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? kindRows.filter((r) => r.name.toLowerCase().includes(q) || r.key.includes(q)) : kindRows;
    }, [kindRows, search]);
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
                <table className="gt-table production__table">
                    <thead>
                        <tr>
                            <th>
                                {data.groupBy === "machine" ? "Machine" : data.flow === "consumed" ? "Input" : "Output"}
                            </th>
                            <th className="production__share-col" aria-label="Share" />
                            <th className="gt-table__num">Total</th>
                            <th className="gt-table__num">Per hour</th>
                            <th aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <ProductionRow
                                key={row.key}
                                row={row}
                                groupBy={data.groupBy}
                                flow={data.flow}
                                share={row.total / maxTotal(row.fluid)}
                                expanded={expanded === row.key}
                                onToggle={() => setExpanded((e) => (e === row.key ? null : row.key))}
                                range={range}
                                minutes={minutes}
                                numberFormat={fmt}
                                onOpenMachine={onOpenMachine}
                                onOpenStats={onOpenStats}
                            />
                        ))}
                    </tbody>
                </table>
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
        ) : !isItem ? (
            <Button variant="text" onClick={() => onOpenMachine(row.key)}>
                Open
            </Button>
        ) : null;

    return (
        <>
            <tr className={cx("production__row", expanded && "production__row--expanded")} onClick={onToggle}>
                <td>
                    <span className="gt-table__item">
                        <span className={cx("production__caret", expanded && "production__caret--open")}>▸</span>
                        {isItem ? (
                            <ItemIcon itemid={row.key} name={row.name} size={22} />
                        ) : (
                            <FactoryIcon size={18} className="production__machine-icon" />
                        )}
                        {row.name}
                    </span>
                </td>
                <td className="production__share-col">
                    <div className="production__share">
                        <div className="production__share-fill" style={{ width: `${Math.max(1, share * 100)}%` }} />
                    </div>
                </td>
                <td className="gt-table__num">{amount(row)}</td>
                <td className="gt-table__num">{formatGTPerHour(row.perHour, row.fluid, numberFormat)}</td>
                {/* Below 768px this column is hidden and the same actions sit in the expanded detail. */}
                <td className="production__actions" onClick={(e) => e.stopPropagation()}>
                    {actions}
                </td>
            </tr>
            {expanded && (
                <tr className="production__detail-row">
                    <td colSpan={5}>
                        <ProductionDetail
                            row={row}
                            groupBy={groupBy}
                            flow={flow}
                            range={range}
                            minutes={minutes}
                            numberFormat={numberFormat}
                            onOpenMachine={onOpenMachine}
                        />
                        {actions && <div className="production__detail-actions">{actions}</div>}
                    </td>
                </tr>
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
    onOpenMachine,
}: {
    row: GTProductionEntry;
    groupBy: GroupBy;
    flow: GTFlow;
    range: GTRange;
    minutes: number | undefined;
    numberFormat: "full" | "compact";
    onOpenMachine: (id: string) => void;
}) {
    const { nonce } = useGT();
    const isItem = groupBy === "item";
    // The history endpoint has no kind filter, so a machine's chart shows its combined output even when
    // the table above shows only its items or fluids.
    const history = useGTPoll(
        () =>
            getGTProductionHistory({
                item: isItem ? row.key : undefined,
                machine: isItem ? undefined : row.key,
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
        <div className="production__detail">
            <div className="production__breakdown">
                <span className="production__detail-label">
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
                        <span className="gt-table__num">
                            {formatGTAmount(b.total, b.fluid || row.fluid, numberFormat)}
                        </span>
                        <span className="gt-table__num production__breakdown-rate">
                            {formatGTPerHour(b.perHour, b.fluid || row.fluid, numberFormat)}/h
                        </span>
                    </div>
                ))}
            </div>
            <div className="production__chart">
                <span className="production__detail-label">
                    {verb} per {data ? describeStep(data.stepMillis) : "window"}
                </span>
                {history.error && <span className="production__detail-label">Couldn't load ({history.error}).</span>}
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
