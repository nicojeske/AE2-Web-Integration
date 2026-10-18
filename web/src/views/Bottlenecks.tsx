// Bottlenecks: which machines crafting jobs wait on, from the recorded crafting history (server-side
// `BottleneckAnalysis`), which job outputs starve for ingredients, and - with GregTech - how each multiblock
// splits its time between running, idle and the ways it can be stopped. Single-grid only, like Statistics.
import { useMemo, useState } from "preact/hooks";

import { getBottlenecks, getGTMachineStates, getServerTickRate } from "../api/client";
import { formatDuration, formatNumber, formatPercent, formatTimestamp } from "../api/format";
import type {
    BottleneckIncident,
    BottleneckMachine,
    BottleneckOutput,
    BottleneckRange,
    Bottlenecks as BottlenecksData,
    GridKey,
    GTMachineStates,
} from "../api/types";
import { useGT, useGTPoll } from "../state/gt";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import type { BadgeVariant } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { ItemIcon } from "../ui/ItemIcon";
import { SegmentedControl } from "../ui/SegmentedControl";
import {
    BOTTLENECK_RANGES,
    DEFAULT_BOTTLENECK_CUSTOM_MINUTES,
    describeBucket,
    formatDelta,
    machineVerdicts,
    sortMachines,
    stateShares,
    toGTRange,
    toHours,
    trendTimestamps,
} from "./bottlenecksModel";
import type { MachineSort } from "./bottlenecksModel";
import { CustomRangeInput } from "./CustomRangeInput";
import { GT_STATUS_LABELS, GT_STATUS_VARIANTS } from "./gtModel";

/** The server caches an analysis for a minute, so polling faster only re-reads it. */
const POLL_MS = 60_000;
const MAX_ROWS = 25;

export interface BottlenecksProps {
    onOpenJob: (gridKey: GridKey, id: number) => void;
    onOpenItemHistory: (itemid: string) => void;
    onOpenMachine: (id: string) => void;
}

export function Bottlenecks(props: BottlenecksProps) {
    const { selected, selectedGrid } = useNetwork();
    if (selected === "all") {
        return (
            <div className="placeholder-panel">
                Bottlenecks are per-network. Pick a single network in the topbar to analyse its crafting history.
            </div>
        );
    }
    if (!selectedGrid) return <div className="placeholder-panel">No network selected.</div>;
    return <BottlenecksPage gridKey={selectedGrid.key} {...props} />;
}

function BottlenecksPage({
    gridKey,
    onOpenJob,
    onOpenItemHistory,
    onOpenMachine,
}: BottlenecksProps & { gridKey: GridKey }) {
    const { settings, setSettings } = usePrefs();
    const gt = useGT();
    const range = settings.bottleneckRange;
    const setRange = (bottleneckRange: BottleneckRange) => setSettings((s) => ({ ...s, bottleneckRange }));
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_BOTTLENECK_CUSTOM_MINUTES);
    const [compare, setCompare] = useState(false);
    const minutes = range === "custom" ? customMinutes : undefined;
    const key = `${gridKey}|${range}|${minutes ?? ""}`;

    const current = useGTPoll(() => getBottlenecks(gridKey, range, minutes), POLL_MS, key, gt.nonce);
    const previous = useGTPoll(
        () => (compare ? getBottlenecks(gridKey, range, minutes, true) : Promise.resolve(null)),
        compare ? POLL_MS : null,
        `${key}|${compare}`,
        gt.nonce,
    );
    const data = current.data;
    const before = compare ? previous.data : null;

    return (
        <div className="page">
            <div className="page__main">
                <header className="page-header">
                    <h2 className="page-header__title">Bottlenecks</h2>
                    <SegmentedControl<BottleneckRange>
                        className="segmented--mono"
                        options={BOTTLENECK_RANGES}
                        value={range}
                        onChange={setRange}
                    />
                    {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
                    <Checkbox
                        checked={compare}
                        onChange={setCompare}
                        title="Show the change against the equally long range just before - e.g. after adding a machine"
                    >
                        <span>Compare with previous period</span>
                    </Checkbox>
                    {data && (
                        <span className="mono-count">
                            {formatNumber(data.jobs)} jobs · {formatNumber(data.cancelled)} cancelled
                        </span>
                    )}
                </header>
                <div className="page__scroll bn__scroll">
                    {current.error === "HISTORY_DISABLED" ? (
                        <div className="placeholder-panel">
                            Bottlenecks come from the recorded crafting history, which needs a history database
                            (history.jdbc_url in the mod&apos;s config).
                        </div>
                    ) : current.error && !data ? (
                        <div className="placeholder-panel browser__error">
                            <p>{current.error}</p>
                            <Button variant="secondary" onClick={gt.refresh}>
                                Retry
                            </Button>
                        </div>
                    ) : !data ? (
                        <div className="placeholder-panel">Analysing crafting history…</div>
                    ) : data.jobs === 0 ? (
                        <div className="placeholder-panel">
                            No tracked crafting jobs in this range. Jobs are recorded while crafting tracking is on for
                            this network (the toggle in the network menu).
                        </div>
                    ) : (
                        <>
                            <TickRateSection data={data} range={range} />
                            <MachinesTable
                                data={data}
                                before={before}
                                range={range}
                                onOpenJob={(id) => onOpenJob(gridKey, id)}
                                onOpenItemHistory={onOpenItemHistory}
                            />
                            <OutputsTable data={data} before={before} />
                            <MissingTable data={data} before={before} />
                            <p className="bn__footer">
                                <b>Held</b> is job time spent waiting on that machine alone, summed over jobs - the best
                                single measure of what delays crafts. <b>Queued</b> is time two or more jobs had work
                                out at it at once. <b>Starved</b> is job time with nothing out at any machine: waiting
                                for ingredients or a free CPU. Machines are pattern providers grouped by name, so
                                identically named providers count as one. Cancelled jobs stuck at a machine count as
                                stuck, not busy, and intervals far beyond a machine&apos;s usual length are clipped and
                                listed as incidents
                                {data.powerData ? " (marked when they overlap a GregTech power outage)" : ""}.
                            </p>
                        </>
                    )}
                    {gt.enabled && (
                        <GTStatesTable range={range} customMinutes={customMinutes} onOpenMachine={onOpenMachine} />
                    )}
                </div>
            </div>
        </div>
    );
}

function SortHead({
    by,
    sort,
    onSort,
    children,
}: {
    by: MachineSort;
    sort: MachineSort;
    onSort: (by: MachineSort) => void;
    children: string;
}) {
    return (
        <button
            type="button"
            className={cx("dtable__sort right", sort === by && "dtable__sort--active")}
            onClick={() => onSort(by)}
        >
            {children}
            {sort === by ? " ↓" : ""}
        </button>
    );
}

function Delta({
    current,
    previous,
    neutral = false,
}: {
    current: number;
    previous: number | undefined;
    /** For amounts that aren't better or worse by growing, like total job time. */
    neutral?: boolean;
}) {
    const text = formatDelta(current, previous);
    if (!text) return null;
    // More waiting is worse, so growth is red.
    const tone = neutral ? "bn__delta--neutral" : current > (previous ?? 0) ? "bn__delta--up" : "bn__delta--down";
    return <span className={cx("bn__delta", tone)}>{text}</span>;
}

function MachinesTable({
    data,
    before,
    range,
    onOpenJob,
    onOpenItemHistory,
}: {
    data: BottlenecksData;
    before: BottlenecksData | null;
    range: BottleneckRange;
    onOpenJob: (id: number) => void;
    onOpenItemHistory: (itemid: string) => void;
}) {
    const [sort, setSort] = useState<MachineSort>("held");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const rows = useMemo(() => sortMachines(data.machines, sort), [data.machines, sort]);
    const previous = useMemo(() => new Map(before?.machines.map((m) => [m.name, m]) ?? []), [before]);
    const maxHeld = Math.max(1, ...data.machines.map((m) => m.heldMillis));
    const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

    return (
        <section className="bn__section">
            <h3 className="section-label bn__title">Machines</h3>
            <div className="dtable bn-table">
                <div className="dtable__head">
                    <span />
                    <span>Machine</span>
                    <span />
                    <SortHead by="held" sort={sort} onSort={setSort}>
                        Held
                    </SortHead>
                    <SortHead by="queued" sort={sort} onSort={setSort}>
                        Queued
                    </SortHead>
                    <SortHead by="busy" sort={sort} onSort={setSort}>
                        Busy
                    </SortHead>
                    <span className="right">Typical</span>
                    <span>Incidents</span>
                </div>
                {shown.map((m) => (
                    <MachineRow
                        key={m.name}
                        machine={m}
                        previous={before ? (previous.get(m.name) ?? null) : undefined}
                        share={m.heldMillis / maxHeld}
                        expanded={expanded === m.name}
                        onToggle={() => setExpanded((e) => (e === m.name ? null : m.name))}
                        data={data}
                        range={range}
                        onOpenJob={onOpenJob}
                        onOpenItemHistory={onOpenItemHistory}
                    />
                ))}
            </div>
            {rows.length > MAX_ROWS && (
                <Button variant="text" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show fewer" : `Show all ${rows.length} machines`}
                </Button>
            )}
        </section>
    );
}

function MachineRow({
    machine: m,
    previous,
    share,
    expanded,
    onToggle,
    data,
    range,
    onOpenJob,
    onOpenItemHistory,
}: {
    machine: BottleneckMachine;
    /** `undefined` when not comparing; `null` when the machine wasn't used in the previous period. */
    previous: BottleneckMachine | null | undefined;
    share: number;
    expanded: boolean;
    onToggle: () => void;
    data: BottlenecksData;
    range: BottleneckRange;
    onOpenJob: (id: number) => void;
    onOpenItemHistory: (itemid: string) => void;
}) {
    const prev = previous === undefined ? undefined : (previous ?? null);
    const prevValue = (pick: (x: BottleneckMachine) => number) =>
        prev === undefined ? undefined : prev === null ? 0 : pick(prev);
    return (
        <>
            <div
                className={cx("dtable__row dtable__row--clickable bn-row", expanded && "bn-row--open")}
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
                <span className="bn-row__caret">{expanded ? "▾" : "▸"}</span>
                <span className="cell-text" title={m.name}>
                    {m.name}
                </span>
                <div className="bn-row__share" title={`${formatPercent(m.utilization)} of the range busy`}>
                    <div style={{ width: `${Math.max(1, share * 100)}%` }} />
                </div>
                <span className="cell-num bn-row__held">
                    {formatDuration(m.heldMillis)}
                    <Delta current={m.heldMillis} previous={prevValue((x) => x.heldMillis)} />
                </span>
                <span className="cell-num">
                    {formatDuration(m.queuedMillis)}
                    <Delta current={m.queuedMillis} previous={prevValue((x) => x.queuedMillis)} />
                </span>
                <span className="cell-num dim">{formatDuration(m.busyMillis)}</span>
                <span className="cell-num dim" title="Median / 90th percentile time a job had work out here">
                    {formatDuration(m.p50Millis)} / {formatDuration(m.p90Millis)}
                </span>
                <span className="bn-row__flags">
                    {m.stuckAtCancel > 0 && (
                        <Badge variant="red" size="sm">
                            {m.stuckAtCancel} stuck
                        </Badge>
                    )}
                    {m.powerAffected > 0 && (
                        <Badge variant="amber" size="sm">
                            {m.powerAffected} power
                        </Badge>
                    )}
                    {m.anomalies > 0 && (
                        <Badge variant="grey" size="sm">
                            {m.anomalies} slow
                        </Badge>
                    )}
                </span>
            </div>
            {expanded && (
                <div className="bn-detail">
                    <MachineDetail
                        machine={m}
                        data={data}
                        range={range}
                        onOpenJob={onOpenJob}
                        onOpenItemHistory={onOpenItemHistory}
                    />
                </div>
            )}
        </>
    );
}

const INCIDENT_LABELS: Record<BottleneckIncident["kind"], { label: string; variant: BadgeVariant; title: string }> = {
    stuck: { label: "Stuck", variant: "red", title: "The job sat here until it was cancelled - not counted as busy" },
    power: { label: "Power", variant: "amber", title: "Ran far longer than usual during a GregTech power outage" },
    anomaly: { label: "Slow", variant: "grey", title: "Ran far longer than usual - counted only up to the cap" },
};

function MachineDetail({
    machine: m,
    data,
    range,
    onOpenJob,
    onOpenItemHistory,
}: {
    machine: BottleneckMachine;
    data: BottlenecksData;
    range: BottleneckRange;
    onOpenJob: (id: number) => void;
    onOpenItemHistory: (itemid: string) => void;
}) {
    const { settings } = usePrefs();
    const timestamps = trendTimestamps(data.trendFrom, data.bucketMillis, m.trendBusyMillis.length);
    const bucket = describeBucket(data.bucketMillis);
    const hours = (v: number) => formatDuration(v * 3_600_000);
    return (
        <div className="bn-detail__grid">
            <div className="bn-detail__col">
                <span className="section-label">Busy per {bucket}</span>
                <Chart
                    variant="bars"
                    values={toHours(m.trendBusyMillis)}
                    timestamps={timestamps}
                    range={range}
                    spanMillis={data.to - data.from}
                    width={600}
                    height={90}
                    showAxes
                    numberFormat={settings.numberFormat}
                    formatValue={hours}
                    ariaLabel={`${m.name}, busy time per ${bucket}`}
                />
                <span className="section-label">Queued per {bucket}</span>
                <Chart
                    variant="bars"
                    values={toHours(m.trendQueuedMillis)}
                    timestamps={timestamps}
                    range={range}
                    spanMillis={data.to - data.from}
                    width={600}
                    height={70}
                    showAxes
                    numberFormat={settings.numberFormat}
                    formatValue={hours}
                    ariaLabel={`${m.name}, queued time per ${bucket}`}
                />
                <span className="bn-detail__note">
                    {formatNumber(m.jobs)} jobs · {formatNumber(m.intervals)} intervals · {formatPercent(m.utilization)}{" "}
                    of the range busy
                    {m.capMillis !== null && ` · intervals over ${formatDuration(m.capMillis)} are clipped`}
                </span>
            </div>
            <div className="bn-detail__col">
                <span className="section-label">Used for</span>
                {m.outputs.map((o) => (
                    <button
                        key={o.itemid}
                        type="button"
                        className="bn-detail__link"
                        title="Show these jobs in Crafting History"
                        onClick={() => onOpenItemHistory(o.itemid)}
                    >
                        <ItemIcon itemid={o.itemid} name={o.name} size={18} />
                        <span className="cell-text">{o.name}</span>
                        <span className="cell-num dim">{formatNumber(o.jobs)} jobs</span>
                    </button>
                ))}
                {m.incidents.length > 0 && <span className="section-label bn-detail__gap">Incidents</span>}
                {m.incidents.map((incident) => {
                    const label = INCIDENT_LABELS[incident.kind];
                    return (
                        <button
                            key={`${incident.jobId}|${incident.started}`}
                            type="button"
                            className="bn-detail__link"
                            title="Open the job in Crafting History"
                            onClick={() => onOpenJob(incident.jobId)}
                        >
                            <span title={label.title}>
                                <Badge variant={label.variant} size="sm">
                                    {label.label}
                                </Badge>
                            </span>
                            <span className="cell-text">{incident.name}</span>
                            <span className="cell-num dim">{formatTimestamp(incident.started)}</span>
                            <span className="cell-num">{formatDuration(incident.durationMillis)}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function OutputsTable({ data, before }: { data: BottlenecksData; before: BottlenecksData | null }) {
    const [showAll, setShowAll] = useState(false);
    const previous = useMemo(() => new Map(before?.outputs.map((o) => [o.itemid, o]) ?? []), [before]);
    const shown = showAll ? data.outputs : data.outputs.slice(0, MAX_ROWS);
    return (
        <section className="bn__section">
            <h3 className="section-label bn__title">Crafted outputs</h3>
            <div className="dtable bn-out-table">
                <div className="dtable__head">
                    <span />
                    <span>Output</span>
                    <span className="right">Jobs</span>
                    <span className="right">Job time ↓</span>
                    <span className="right">Typical</span>
                    <span className="right">Starved</span>
                    <span>Held up by</span>
                </div>
                {shown.map((o) => (
                    <OutputRow key={o.itemid} output={o} previous={before ? previous.get(o.itemid) : undefined} />
                ))}
            </div>
            {data.outputs.length > MAX_ROWS && (
                <Button variant="text" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show fewer" : `Show all ${data.outputs.length} outputs`}
                </Button>
            )}
        </section>
    );
}

/** Below this a server is visibly lagging: machines and crafts run that much slower. */
const LAG_TPS = 18;

function TickRateSection({ data, range }: { data: BottlenecksData; range: BottleneckRange }) {
    const gt = useGT();
    const { settings } = usePrefs();
    const rate = useGTPoll(
        () => getServerTickRate(data.from, data.to, 200),
        POLL_MS,
        `${data.from}|${data.to}`,
        gt.nonce,
    );
    const r = rate.data;
    if (!r) return null;
    const sampled = r.tps.filter((t) => t >= 0);
    if (sampled.length === 0) return null;
    const lagShare = sampled.filter((t) => t < LAG_TPS).length / sampled.length;
    const worst = Math.max(...r.maxTickMillis);
    const timestamps = r.tps.map((_, i) => r.from + i * r.stepMillis);
    return (
        <section className="bn__section">
            <h3 className="section-label bn__title">
                Server tick rate
                {r.currentTps >= 0 && (
                    <span className={cx("dim", r.currentTps < LAG_TPS && "bn-tps--lag")}>
                        {" "}
                        · now {r.currentTps.toFixed(1)} TPS
                        {r.currentMspt >= 0 && ` · ${r.currentMspt.toFixed(1)} ms/tick`}
                    </span>
                )}
            </h3>
            <div className="bn-tps">
                <Chart
                    values={r.tps.map((t) => (t < 0 ? null : t))}
                    timestamps={timestamps}
                    range={range}
                    spanMillis={data.to - data.from}
                    width={1000}
                    height={70}
                    showAxes
                    yTickCount={2}
                    zeroBased
                    yMax={20}
                    threshold={LAG_TPS}
                    numberFormat={settings.numberFormat}
                    formatValue={(v) => `${v.toFixed(1)} TPS`}
                    ariaLabel="Server ticks per second"
                />
                <span className="bn-detail__note">
                    Below {LAG_TPS} TPS {Math.round(lagShare * 100)}% of the time
                    {worst > 0 && ` · longest tick ${formatDuration(worst)}`}. Lag slows every machine and craft alike,
                    so weigh the times below against it.
                </span>
            </div>
        </section>
    );
}

function MissingTable({ data, before }: { data: BottlenecksData; before: BottlenecksData | null }) {
    const [showAll, setShowAll] = useState(false);
    const previous = useMemo(() => new Map(before?.missingIngredients.map((m) => [m.itemid, m]) ?? []), [before]);
    const shown = showAll ? data.missingIngredients : data.missingIngredients.slice(0, MAX_ROWS);
    return (
        <section className="bn__section">
            <h3 className="section-label bn__title">
                Missing ingredients
                <span className="dim">
                    {" "}
                    · {formatNumber(data.failedPlans)} failed plan{data.failedPlans === 1 ? "" : "s"}
                </span>
            </h3>
            {data.missingIngredients.length === 0 ? (
                <p className="bn__empty">No crafting plan came back with missing ingredients in this range.</p>
            ) : (
                <div className="dtable bn-miss-table">
                    <div className="dtable__head">
                        <span />
                        <span>Ingredient</span>
                        <span className="right">Plans ↓</span>
                        <span className="right">Missing</span>
                        <span>Last missing</span>
                        <span>Blocked</span>
                    </div>
                    {shown.map((m) => (
                        <div key={m.itemid} className="dtable__row bn-miss-row">
                            <ItemIcon itemid={m.itemid} name={m.name} size={22} />
                            <span className="cell-text" title={m.name}>
                                {m.name}
                            </span>
                            <span className="cell-num">
                                {formatNumber(m.plans)}
                                <Delta
                                    current={m.plans}
                                    previous={before ? (previous.get(m.itemid)?.plans ?? 0) : undefined}
                                />
                            </span>
                            <span className="cell-num">{formatNumber(m.amount)}</span>
                            <span className="cell-num dim">{formatTimestamp(m.lastSeen)}</span>
                            <span className="cell-text dim" title={m.blockedOutputs.join(", ")}>
                                {m.blockedOutputs.join(", ")}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {data.missingIngredients.length > MAX_ROWS && (
                <Button variant="text" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show fewer" : `Show all ${data.missingIngredients.length} ingredients`}
                </Button>
            )}
        </section>
    );
}

function OutputRow({ output: o, previous }: { output: BottleneckOutput; previous: BottleneckOutput | undefined }) {
    const starvedDelta = previous === undefined ? null : Math.round((o.starvedShare - previous.starvedShare) * 100);
    return (
        <div className="dtable__row bn-out-row">
            <ItemIcon itemid={o.itemid} name={o.name} size={22} />
            <span className="cell-text" title={o.name}>
                {o.name}
            </span>
            <span className="cell-num">
                {formatNumber(o.jobs)}
                {o.cancelled > 0 && <span className="dim"> ({formatNumber(o.cancelled)} cancelled)</span>}
            </span>
            <span className="cell-num">
                {formatDuration(o.completedMillis)}
                <Delta current={o.completedMillis} previous={previous?.completedMillis} neutral />
            </span>
            <span className="cell-num dim" title="Median / 90th percentile duration of the completed jobs">
                {formatDuration(o.p50Millis)} / {formatDuration(o.p90Millis)}
            </span>
            <span className={cx("cell-num", o.starvedShare >= 0.25 && "bn-out-row__starved")}>
                {Math.round(o.starvedShare * 100)}%
                {starvedDelta !== null && starvedDelta !== 0 && (
                    <span className={cx("bn__delta", starvedDelta > 0 ? "bn__delta--up" : "bn__delta--down")}>
                        {starvedDelta > 0 ? "+" : "−"}
                        {Math.abs(starvedDelta)}
                    </span>
                )}
            </span>
            <span className="cell-text dim" title={o.topBlocker ?? undefined}>
                {o.topBlocker ? `${o.topBlocker} · ${formatDuration(o.topBlockerMillis)}` : "—"}
            </span>
        </div>
    );
}

function GTStatesTable({
    range,
    customMinutes,
    onOpenMachine,
}: {
    range: BottleneckRange;
    customMinutes: number;
    onOpenMachine: (id: string) => void;
}) {
    const gt = useGT();
    const { machineNames } = usePrefs();
    const gtRange = toGTRange(range, customMinutes);
    const states = useGTPoll(
        () => getGTMachineStates(gtRange.range, gtRange.minutes),
        POLL_MS,
        `${gtRange.range}|${gtRange.minutes ?? ""}`,
        gt.nonce,
    );
    if (states.notAvailable || states.error === "HISTORY_DISABLED") return null;
    const rows: GTMachineStates[] = states.data ?? [];

    return (
        <section className="bn__section">
            <h3 className="section-label bn__title">GregTech machines</h3>
            {states.error && !states.data ? (
                <div className="placeholder-panel browser__error">{states.error}</div>
            ) : !states.data ? (
                <div className="placeholder-panel">Loading machine states…</div>
            ) : rows.length === 0 ? (
                <div className="placeholder-panel">
                    No machine states recorded in this range yet - they are recorded from the next GregTech scan on.
                </div>
            ) : (
                <div className="dtable bn-gt-table">
                    <div className="dtable__head">
                        <span>Machine</span>
                        <span>Time split</span>
                        <span className="right">Running ↓</span>
                        <span className="right">Observed</span>
                        <span />
                    </div>
                    {rows.map((m) => (
                        <div
                            key={m.id}
                            className="dtable__row dtable__row--clickable bn-gt-row"
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenMachine(m.id)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") onOpenMachine(m.id);
                            }}
                        >
                            <span className="cell-text" title={m.id}>
                                {machineNames[m.id] ?? m.name}
                            </span>
                            <div className="bn-gt-row__split">
                                {stateShares(m).map(({ status, share }) => (
                                    <div
                                        key={status}
                                        className={`bn-gt-row__seg bn-gt-row__seg--${GT_STATUS_VARIANTS[status]}`}
                                        style={{ width: `${share * 100}%` }}
                                        title={`${GT_STATUS_LABELS[status]} ${formatPercent(share)}`}
                                    />
                                ))}
                            </div>
                            <span className="cell-num">{Math.round(m.runningShare * 100)}%</span>
                            <span className="cell-num dim">{formatDuration(m.observedMillis)}</span>
                            <span className="bn-row__flags">
                                {machineVerdicts(m).map((v) => (
                                    <span key={v.label} title={v.title}>
                                        <Badge variant={v.variant} size="sm">
                                            {v.label}
                                        </Badge>
                                    </span>
                                ))}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
