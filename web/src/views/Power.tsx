// GregTech Power section (docs/gt-hub/phase-2-frontend.md §4.2): the main LSC (pinned in synced prefs,
// else the largest) as a hero panel with its history always shown, then a table of every other Lapotronic
// Supercapacitor and team wireless EU network, with fill, net rate and a time-to-empty/full countdown,
// each expandable into its stored-EU history. Rates read as amps at a tier plus raw EU/t.
import { useState } from "preact/hooks";

import { getGTEnergy, getGTPower, getGTPowerHistory } from "../api/client";
import { formatDuration, formatEU, formatEUt, formatEUtTier, gtTierName } from "../api/format";
import type { GTEnergyMachine, GTPowerSource, GTRange } from "../api/types";
import { GT_FAST_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { cx } from "../ui/cx";
import { SegmentedControl } from "../ui/SegmentedControl";
import { CustomRangeInput } from "./CustomRangeInput";
import { GTPollState, useNow } from "./gtCommon";
import { gtRangeOptions } from "./gtModel";
import { DEFAULT_CUSTOM_MINUTES, lastNonGap, pointTimestamps, toValues } from "./statsModel";

/** Long.MAX_VALUE - the server saturates power history there (phase-1 §3). */
const HISTORY_CAP = 9.223372036854776e18;

export function Power() {
    const { nonce } = useGT();
    const power = useGTPoll(getGTPower, GT_FAST_POLL_MS, "power", nonce);
    const now = useNow(1000);
    const { mainPowerSource, setMainPowerSource } = usePrefs();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

    return (
        <GTPollState poll={power} what="power sources">
            {({ sources }) => {
                if (sources.length === 0) {
                    return (
                        <div className="page">
                            <div className="page__main">
                                <div className="page__scroll">
                                    <div className="placeholder-panel">
                                        No Lapotronic Supercapacitors or wireless EU networks found yet.
                                    </div>
                                    <EnergyByMachine />
                                </div>
                            </div>
                        </div>
                    );
                }
                const main = pickMain(sources, mainPowerSource);
                const others = main ? sources.filter((s) => s.id !== main.id) : sources;
                const lscCount = sources.filter((s) => s.kind === "LSC").length;
                const wirelessCount = sources.length - lscCount;
                const toggle = (id: string) =>
                    setExpanded((e) => {
                        const next = new Set(e);
                        if (!next.delete(id)) next.add(id);
                        return next;
                    });
                return (
                    <div className="page">
                        <div className="page__main">
                            <header className="page-header">
                                <h2 className="page-header__title">Power</h2>
                                <span className="page-header__sub">
                                    {[
                                        lscCount > 0 && `${lscCount} LSC`,
                                        wirelessCount > 0 &&
                                            `${wirelessCount} wireless network${wirelessCount === 1 ? "" : "s"}`,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                            </header>
                            <div className="page__scroll">
                                {main ? (
                                    <MainPowerPanel
                                        source={main}
                                        now={now}
                                        pinned={main.id === mainPowerSource}
                                        onUnpin={() => setMainPowerSource(null)}
                                    />
                                ) : (
                                    sources.length > 1 && <PowerTotals sources={sources} now={now} />
                                )}
                                {others.length > 0 && (
                                    <>
                                        {main && (
                                            <div className="power__section-label section-label">Other sources</div>
                                        )}
                                        <div className="dtable power-table">
                                            <div className="dtable__head">
                                                <span>Source</span>
                                                <span>Kind</span>
                                                <span>Fill</span>
                                                <span className="right">Stored</span>
                                                <span className="right">Net</span>
                                                <span className="right">Outlook</span>
                                                <span />
                                            </div>
                                            {others.map((source) => (
                                                <PowerRow
                                                    key={source.id}
                                                    source={source}
                                                    now={now}
                                                    expanded={expanded.has(source.id)}
                                                    onToggle={() => toggle(source.id)}
                                                    onMakeMain={
                                                        source.kind === "LSC"
                                                            ? () => setMainPowerSource(source.id)
                                                            : undefined
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </>
                                )}
                                <EnergyByMachine />
                            </div>
                        </div>
                    </div>
                );
            }}
        </GTPollState>
    );
}

const ENERGY_ROWS = 15;

/** Where the power goes and which generators carry the base, from the per-machine EU the scans sample. */
function EnergyByMachine() {
    const { nonce } = useGT();
    const { machineNames } = usePrefs();
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(24 * 60);
    const [showAll, setShowAll] = useState(false);
    const minutes = range === "custom" ? customMinutes : undefined;
    const energy = useGTPoll(() => getGTEnergy(range, minutes), 60_000, `${range}|${minutes ?? ""}`, nonce);
    if (energy.notAvailable || energy.error === "HISTORY_DISABLED") return null;
    const data = energy.data;
    const ticks = data ? (data.to - data.from) / 50 : 1;
    const consumers = data?.machines.filter((m) => m.consumed > 0) ?? [];
    const generators = data?.machines.filter((m) => m.generated > 0) ?? [];
    const rows = (list: GTEnergyMachine[], pick: (m: GTEnergyMachine) => number, total: number) =>
        (showAll ? list : list.slice(0, ENERGY_ROWS)).map((m) => (
            <div key={m.id} className="dtable__row energy-row">
                <span className="cell-text" title={m.id}>
                    {machineNames[m.id] ?? m.name}
                    {m.ownerName && <span className="dim"> · {m.ownerName}</span>}
                </span>
                <span className="cell-text dim">{m.voltageTier >= 0 ? gtTierName(m.voltageTier) : "—"}</span>
                <span className="energy-row__share">
                    <span style={{ width: `${total > 0 ? (pick(m) / total) * 100 : 0}%` }} />
                </span>
                <span className="cell-num">{total > 0 ? Math.round((pick(m) / total) * 100) : 0}%</span>
                <span className="cell-num">{formatEUt(pick(m) / ticks)}</span>
                <span className="cell-num dim">{formatEU(pick(m))}</span>
            </div>
        ));
    const head = (label: string) => (
        <div className="dtable__head">
            <span>{label}</span>
            <span>Tier</span>
            <span>Share</span>
            <span />
            <span className="right">Avg EU/t</span>
            <span className="right">EU</span>
        </div>
    );
    return (
        <section className="energy">
            <div className="energy__header">
                <span className="power__section-label section-label">Energy by machine</span>
                {data && (
                    <span className="dim">
                        using {formatEUt(data.totalConsumed / ticks)} · generating{" "}
                        {formatEUt(data.totalGenerated / ticks)} on average
                    </span>
                )}
                <RangeControls
                    range={range}
                    onRange={setRange}
                    customMinutes={customMinutes}
                    onCustomMinutes={setCustomMinutes}
                />
            </div>
            {!data ? (
                <div className="placeholder-panel">{energy.error ?? "Loading energy use…"}</div>
            ) : data.machines.length === 0 ? (
                <div className="placeholder-panel">No machine used or made EU in this range yet.</div>
            ) : (
                <>
                    {consumers.length > 0 && (
                        <div className="dtable energy-table">
                            {head("Consumer")}
                            {rows(consumers, (m) => m.consumed, data.totalConsumed)}
                        </div>
                    )}
                    {generators.length > 0 && (
                        <div className="dtable energy-table">
                            {head("Generator")}
                            {rows(generators, (m) => m.generated, data.totalGenerated)}
                        </div>
                    )}
                    {Math.max(consumers.length, generators.length) > ENERGY_ROWS && (
                        <Button variant="text" onClick={() => setShowAll((v) => !v)}>
                            {showAll ? "Show fewer" : "Show all machines"}
                        </Button>
                    )}
                    <p className="energy__note">
                        Sampled every GregTech scan from each running machine&apos;s EU/t, counted in ticks so lag
                        doesn&apos;t inflate it. Unloaded machines aren&apos;t counted.
                    </p>
                </>
            )}
        </section>
    );
}

/** The pinned LSC if it's still there, else the one with the largest capacity; `null` without any LSC. */
function pickMain(sources: GTPowerSource[], pinned: string | null): GTPowerSource | null {
    const lscs = sources.filter((s) => s.kind === "LSC");
    const pinnedSource = lscs.find((s) => s.id === pinned);
    if (pinnedSource) return pinnedSource;
    let best: GTPowerSource | null = null;
    for (const s of lscs) {
        if (best === null || BigInt(s.capacity ?? "0") > BigInt(best.capacity ?? "0")) best = s;
    }
    return best;
}

/** A server countdown (as of `sampledAt`) ticked down to `now`. */
function liveSeconds(seconds: number | null, sampledAt: number, now: number): number | null {
    return seconds === null ? null : Math.max(0, seconds - (now - sampledAt) / 1000);
}

function PowerTotals({ sources, now }: { sources: GTPowerSource[]; now: number }) {
    const stored = sources.reduce((sum, s) => sum + BigInt(s.stored), 0n);
    const rates = sources.map((s) => s.netPerTick).filter((n): n is number => n !== null);
    const net = rates.reduce((a, b) => a + b, 0);
    let soonest: { seconds: number; source: GTPowerSource } | null = null;
    for (const s of sources) {
        const seconds = liveSeconds(s.secondsToEmpty, s.sampledAt, now);
        if (seconds !== null && (soonest === null || seconds < soonest.seconds)) soonest = { seconds, source: s };
    }

    return (
        <div className="power__totals">
            <div className="power__kpi">
                <span className="power__kpi-label">Total stored</span>
                <span className="power__kpi-value" title={`${stored.toLocaleString("en-US")} EU`}>
                    {formatEU(stored.toString())}
                </span>
            </div>
            <div className="power__kpi">
                <span className="power__kpi-label">Total net</span>
                <span className={cx("power__kpi-value", netClass(rates.length > 0 ? net : null))}>
                    {rates.length > 0 ? signedEUt(net) : "—"}
                </span>
            </div>
            <div className="power__kpi">
                <span className="power__kpi-label">Soonest empty</span>
                <span className={cx("power__kpi-value", soonest !== null && "power__net--negative")}>
                    {soonest === null ? "Nothing draining" : formatDuration(soonest.seconds * 1000)}
                </span>
                {soonest && <span className="power__kpi-sub">{soonest.source.name}</span>}
            </div>
        </div>
    );
}

function signedEUt(perTick: number): string {
    return perTick > 0 ? `+${formatEUt(perTick)}` : perTick < 0 ? `−${formatEUt(-perTick)}` : formatEUt(0);
}

/** `"+3.7A IV · 30k EU/t"`. */
function signedRate(perTick: number): string {
    return perTick > 0 ? `+${formatEUtTier(perTick)}` : perTick < 0 ? `−${formatEUtTier(perTick)}` : formatEUt(0);
}

/** Time-to-empty/full, or a bare direction when there's no countdown (a wireless network). */
function etaText(s: GTPowerSource, now: number): { text: string | null; draining: boolean } {
    const toEmpty = liveSeconds(s.secondsToEmpty, s.sampledAt, now);
    const toFull = liveSeconds(s.secondsToFull, s.sampledAt, now);
    if (toEmpty !== null) return { text: `Empty in ${formatDuration(toEmpty * 1000)}`, draining: true };
    if (toFull !== null) return { text: `Full in ${formatDuration(toFull * 1000)}`, draining: false };
    // Filling with no capacity to fill up to - a wireless network.
    if (s.netPerTick !== null) return { text: s.netPerTick > 0 ? "Filling" : "Stable", draining: false };
    return { text: null, draining: false };
}

function sourceMeta(s: GTPowerSource): string {
    const owner = s.ownerName ?? "Admin only";
    return s.kind === "LSC" && s.x !== null ? `${owner} · ${s.x}, ${s.y}, ${s.z} (dim ${s.dim})` : owner;
}

/** In and out on their own lines - each rate already has a `·` inside it. */
function IoRates({ source: s }: { source: GTPowerSource }) {
    if (s.avgInPerTick === null || s.avgOutPerTick === null) return null;
    return (
        <span className="power-card__io">
            <span>in {formatEUtTier(s.avgInPerTick)}</span>
            <span>out {formatEUtTier(s.avgOutPerTick)}</span>
        </span>
    );
}

function MainPowerPanel({
    source: s,
    now,
    pinned,
    onUnpin,
}: {
    source: GTPowerSource;
    now: number;
    pinned: boolean;
    onUnpin: () => void;
}) {
    const eta = etaText(s, now);
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);
    return (
        <section className={cx("power-main", !s.loaded && "power--unloaded")}>
            <div className="power-main__head">
                <span className="power-main__name">{s.name}</span>
                <span className="power-main__meta">{sourceMeta(s)}</span>
                {!s.loaded && (
                    <Badge variant="grey" size="sm">
                        Not loaded
                    </Badge>
                )}
                <Badge variant="teal" size="sm">
                    {pinned ? "Main" : "Main (auto)"}
                </Badge>
                {pinned && (
                    <Button variant="text" onClick={onUnpin} title="Go back to the largest LSC">
                        Unpin
                    </Button>
                )}
                <div className="page-header__end">
                    <RangeControls
                        range={range}
                        onRange={setRange}
                        customMinutes={customMinutes}
                        onCustomMinutes={setCustomMinutes}
                    />
                </div>
            </div>

            <div className="power-main__summary">
                <div className="power-main__stat">
                    <span className="section-label">Stored</span>
                    <span className="power-main__stored" title={`${BigInt(s.stored).toLocaleString("en-US")} EU`}>
                        {formatEU(s.stored)}
                        {s.capacity !== null && <span className="power-main__capacity"> / {formatEU(s.capacity)}</span>}
                    </span>
                </div>
                <div className="power-main__stat">
                    <span className="section-label">Net</span>
                    {s.netPerTick === null ? (
                        <span className="power-main__pending">Rate available after the next scans</span>
                    ) : (
                        <span className={cx("power-main__net", netClass(s.netPerTick))}>
                            {signedRate(s.netPerTick)}
                        </span>
                    )}
                    <IoRates source={s} />
                </div>
                <div className="power-main__stat">
                    <span className="section-label">Outlook</span>
                    <span className={cx("power-main__eta", eta.draining && "power__net--negative")}>
                        {eta.text ?? "—"}
                    </span>
                </div>
                {s.fill !== null && (
                    <div className="power-main__gauge">
                        <span className="power-main__fill" style={{ color: fillColor(s.fill) }}>
                            {(s.fill * 100).toFixed(1)}%
                        </span>
                        <div className="power-main__track">
                            <div style={{ width: `${s.fill * 100}%`, background: fillColor(s.fill) }} />
                            <span className="power-main__tick" style={{ left: "10%", background: "var(--red)" }} />
                            <span className="power-main__tick" style={{ left: "30%", background: "var(--amber)" }} />
                        </div>
                    </div>
                )}
            </div>

            <PowerHistory source={s} range={range} customMinutes={customMinutes} wide />
        </section>
    );
}

function RangeControls({
    range,
    onRange,
    customMinutes,
    onCustomMinutes,
}: {
    range: GTRange;
    onRange: (range: GTRange) => void;
    customMinutes: number;
    onCustomMinutes: (minutes: number) => void;
}) {
    return (
        <span className="power__range">
            {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={onCustomMinutes} />}
            <SegmentedControl<GTRange>
                className="segmented--mono"
                options={HISTORY_RANGES}
                value={range}
                onChange={onRange}
            />
        </span>
    );
}

function netClass(net: number | null): string | false {
    return net !== null && net !== 0 && (net > 0 ? "power__net--positive" : "power__net--negative");
}

function fillColor(fill: number): string {
    return fill < 0.1 ? "var(--red)" : fill < 0.3 ? "var(--amber)" : "var(--cyan)";
}

function PowerRow({
    source: s,
    now,
    expanded,
    onToggle,
    onMakeMain,
}: {
    source: GTPowerSource;
    now: number;
    expanded: boolean;
    onToggle: () => void;
    /** Only on LSCs - a wireless network can't be the main source. */
    onMakeMain?: () => void;
}) {
    const eta = etaText(s, now);
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);

    return (
        <>
            <div className={cx("dtable__row power-row", !s.loaded && "power--unloaded", expanded && "power-row--open")}>
                <div className="cell-stack">
                    <span className="cell-text">{s.name}</span>
                    <span className="cell-sub">
                        {sourceMeta(s)}
                        {!s.loaded ? " · not loaded" : ""}
                    </span>
                </div>
                <Badge variant={s.kind === "LSC" ? "teal" : "purple"} size="sm">
                    {s.kind === "LSC" ? "LSC" : "Wireless"}
                </Badge>
                <div className="power-row__fill">
                    {s.fill !== null ? (
                        <>
                            <div className="bar">
                                <div
                                    className="bar__fill"
                                    style={{ width: `${s.fill * 100}%`, background: fillColor(s.fill) }}
                                />
                            </div>
                            <span>{(s.fill * 100).toFixed(1)}%</span>
                        </>
                    ) : (
                        <span className="dim">—</span>
                    )}
                </div>
                <span className="cell-num power-row__stored" title={`${BigInt(s.stored).toLocaleString("en-US")} EU`}>
                    {formatEU(s.stored)}
                    {s.capacity !== null && ` / ${formatEU(s.capacity)}`}
                </span>
                <span className={cx("cell-num", netClass(s.netPerTick))}>
                    {s.netPerTick === null ? "pending" : signedRate(s.netPerTick)}
                </span>
                <span className={cx("cell-num", eta.draining && "power__net--negative")}>{eta.text ?? "—"}</span>
                <span className="power-row__actions">
                    {onMakeMain && (
                        <Button variant="text" onClick={onMakeMain} title="Show this LSC at the top">
                            Main
                        </Button>
                    )}
                    <Button variant="text" onClick={onToggle} aria-expanded={expanded}>
                        {expanded ? "Hide" : "History"}
                    </Button>
                </span>
            </div>
            {expanded && (
                <div className="power-row__history">
                    <RangeControls
                        range={range}
                        onRange={setRange}
                        customMinutes={customMinutes}
                        onCustomMinutes={setCustomMinutes}
                    />
                    <PowerHistory source={s} range={range} customMinutes={customMinutes} />
                </div>
            )}
        </>
    );
}

const HISTORY_RANGES = gtRangeOptions(["15m", "1h", "6h", "24h", "7d", "30d", "custom"]);
const RANGE_LABEL: Partial<Record<GTRange, string>> = {
    "15m": "last 15 min",
    "1h": "last hour",
    "6h": "last 6h",
    "24h": "last 24h",
    "7d": "last 7 days",
    "30d": "last 30 days",
    custom: "custom range",
};
const HISTORY_W = 420;
/** The main panel's chart geometry - wider and taller, since it spans the whole content column. */
const HISTORY_W_WIDE = 960;
const HISTORY_POINTS = 120;

function PowerHistory({
    source,
    range,
    customMinutes,
    wide = false,
}: {
    source: GTPowerSource;
    range: GTRange;
    customMinutes: number;
    wide?: boolean;
}) {
    const { nonce } = useGT();
    const { settings } = usePrefs();
    const minutes = range === "custom" ? customMinutes : undefined;
    const history = useGTPoll(
        () => getGTPowerHistory(source.id, range, HISTORY_POINTS, minutes),
        GT_FAST_POLL_MS * 3,
        `${source.id}|${range}|${minutes ?? ""}`,
        nonce,
    );

    const data = history.data;
    const stored = data ? toValues(data.stored) : [];
    const avgIn = data ? toValues(data.avgIn) : [];
    const avgOut = data ? toValues(data.avgOut) : [];
    const net = avgIn.map((v, i) => {
        const out = avgOut[i];
        return v === null || out === null || out === undefined ? null : v - out;
    });
    const timestamps = data ? pointTimestamps(data.from, data.stepMillis, stored.length) : [];
    const spanMillis = data ? data.to - data.from : undefined;
    const capped = (lastNonGap(stored)?.value ?? 0) >= HISTORY_CAP;

    return (
        <div className={cx("power-history", wide && "power-history--wide")}>
            {history.error && <div className="power-history__note">Couldn't load history ({history.error}).</div>}
            {data && (
                <>
                    <span className="section-label">Stored · {RANGE_LABEL[range] ?? range}</span>
                    <Chart
                        values={stored}
                        timestamps={timestamps}
                        range={range}
                        spanMillis={spanMillis}
                        width={wide ? HISTORY_W_WIDE : HISTORY_W}
                        height={wide ? 220 : 120}
                        showAxes
                        formatValue={(v) => formatEU(v).replace(" EU", "")}
                        numberFormat={settings.numberFormat}
                        zeroBased
                        yMax={source.capacity !== null ? Number(source.capacity) : null}
                        ariaLabel={`${source.name}, stored EU`}
                    />
                    {capped && (
                        <div className="power-history__note">
                            Stored EU is past what the history can hold (9.2E EU), so the chart is flat at that cap.
                        </div>
                    )}
                    {net.some((v) => v !== null) && (
                        <>
                            <span className="section-label">Net EU/t (in − out)</span>
                            <div className="power-history__net">
                                <Chart
                                    values={net}
                                    timestamps={timestamps}
                                    range={range}
                                    spanMillis={spanMillis}
                                    width={wide ? HISTORY_W_WIDE : HISTORY_W}
                                    height={wide ? 100 : 70}
                                    showAxes
                                    yTickCount={2}
                                    formatValue={(v) =>
                                        (v < 0 ? `−${formatEUt(-v)}` : formatEUt(v)).replace(" EU/t", "")
                                    }
                                    ariaLabel={`${source.name}, net EU per tick`}
                                />
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
