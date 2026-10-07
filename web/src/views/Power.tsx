// GregTech Power section (docs/gt-hub/phase-2-frontend.md §4.2): the main LSC (pinned in synced prefs,
// else the largest) as a hero panel with its history always shown, then one card per other Lapotronic
// Supercapacitor and per team wireless EU network, with fill, net rate and a time-to-empty/full
// countdown, each expandable into its stored-EU history. Rates read as amps at a tier plus raw EU/t.
import { useState } from "preact/hooks";

import { getGTPower, getGTPowerHistory } from "../api/client";
import { formatDuration, formatEU, formatEUt, formatEUtTier } from "../api/format";
import type { GTPowerSource, GTRange } from "../api/types";
import { GT_FAST_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chart } from "../ui/Chart";
import { cx } from "../ui/cx";
import { ProgressBar } from "../ui/ProgressBar";
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
                        <div className="placeholder-panel">
                            No Lapotronic Supercapacitors or wireless EU networks found yet.
                        </div>
                    );
                }
                const main = pickMain(sources, mainPowerSource);
                const others = main ? sources.filter((s) => s.id !== main.id) : sources;
                return (
                    <section className="power">
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
                        {main && others.length > 0 && <span className="power__section-label">Other sources</span>}
                        {others.length > 0 && (
                            <div className="power__grid">
                                {others.map((source) => (
                                    <PowerCard
                                        key={source.id}
                                        source={source}
                                        now={now}
                                        expanded={expanded.has(source.id)}
                                        onToggle={() =>
                                            setExpanded((e) => {
                                                const next = new Set(e);
                                                if (!next.delete(source.id)) next.add(source.id);
                                                return next;
                                            })
                                        }
                                        onMakeMain={
                                            source.kind === "LSC" ? () => setMainPowerSource(source.id) : undefined
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                );
            }}
        </GTPollState>
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
    return (
        <Card className={cx("power-main", !s.loaded && "power-card--unloaded")}>
            <div className="power-card__head">
                <div className="power-card__identity">
                    <span className="power-main__name">{s.name}</span>
                    <span className="power-card__meta">{sourceMeta(s)}</span>
                </div>
                {!s.loaded && <Badge variant="grey">Not loaded</Badge>}
                <Badge variant="teal" size="sm">
                    {pinned ? "Main" : "Main (auto)"}
                </Badge>
                {pinned && (
                    <Button variant="text" onClick={onUnpin} title="Go back to the largest LSC">
                        Unpin
                    </Button>
                )}
            </div>

            <div className="power-main__summary">
                <div className="power-main__stat">
                    <span className="power__kpi-label">Stored</span>
                    <span className="power-main__stored" title={`${BigInt(s.stored).toLocaleString("en-US")} EU`}>
                        {formatEU(s.stored)}
                        {s.capacity !== null && <span className="power-card__capacity"> / {formatEU(s.capacity)}</span>}
                    </span>
                </div>
                <div className="power-main__stat">
                    <span className="power__kpi-label">Net</span>
                    {s.netPerTick === null ? (
                        <span className="power-card__pending">Rate available after the next scans</span>
                    ) : (
                        <span className={cx("power-main__net", netClass(s.netPerTick))}>
                            {signedRate(s.netPerTick)}
                        </span>
                    )}
                    <IoRates source={s} />
                </div>
                {eta.text && (
                    <div className="power-main__stat">
                        <span className="power__kpi-label">Outlook</span>
                        <span className={cx("power-main__eta", eta.draining && "power__net--negative")}>
                            {eta.text}
                        </span>
                    </div>
                )}
            </div>

            {s.fill !== null && (
                <div className="power-card__gauge">
                    <ProgressBar percent={s.fill * 100} height={14} color={fillColor(s.fill)} />
                    <span className="power-card__fill">{(s.fill * 100).toFixed(1)}%</span>
                </div>
            )}

            <PowerHistory source={s} wide />
        </Card>
    );
}

function netClass(net: number | null): string | false {
    return net !== null && net !== 0 && (net > 0 ? "power__net--positive" : "power__net--negative");
}

function fillColor(fill: number): string {
    return fill < 0.1 ? "var(--red)" : fill < 0.3 ? "var(--amber)" : "var(--teal)";
}

function PowerCard({
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

    return (
        <Card className={cx("power-card", !s.loaded && "power-card--unloaded")}>
            <div className="power-card__head">
                <div className="power-card__identity">
                    <span className="power-card__name">{s.name}</span>
                    <span className="power-card__meta">{sourceMeta(s)}</span>
                </div>
                {!s.loaded && <Badge variant="grey">Not loaded</Badge>}
                <Badge variant={s.kind === "LSC" ? "teal" : "purple"} size="sm">
                    {s.kind === "LSC" ? "LSC" : "Wireless"}
                </Badge>
            </div>

            {s.fill !== null && (
                <div className="power-card__gauge">
                    <ProgressBar percent={s.fill * 100} height={10} color={fillColor(s.fill)} />
                    <span className="power-card__fill">{(s.fill * 100).toFixed(1)}%</span>
                </div>
            )}

            <div className="power-card__stored" title={`${BigInt(s.stored).toLocaleString("en-US")} EU`}>
                {formatEU(s.stored)}
                {s.capacity !== null && <span className="power-card__capacity"> / {formatEU(s.capacity)}</span>}
            </div>

            <div className="power-card__rates">
                {s.netPerTick === null ? (
                    <span className="power-card__pending">Rate available after the next scans</span>
                ) : (
                    <>
                        <span className={cx("power-card__net", netClass(s.netPerTick))}>
                            {signedRate(s.netPerTick)}
                        </span>
                        <IoRates source={s} />
                    </>
                )}
            </div>

            <div className="power-card__foot">
                {eta.text && (
                    <span className={cx("power-card__eta", eta.draining && "power__net--negative")}>{eta.text}</span>
                )}
                <div className="power-card__actions">
                    {onMakeMain && (
                        <Button variant="text" onClick={onMakeMain}>
                            Set as main
                        </Button>
                    )}
                    <Button variant="text" onClick={onToggle} aria-expanded={expanded}>
                        {expanded ? "Hide history" : "History"}
                    </Button>
                </div>
            </div>

            {expanded && <PowerHistory source={s} />}
        </Card>
    );
}

const HISTORY_RANGES = gtRangeOptions(["15m", "1h", "6h", "24h", "7d", "30d", "custom"]);
const HISTORY_W = 420;
/** The main panel's chart geometry - wider and taller, since it spans the whole content column. */
const HISTORY_W_WIDE = 960;
const HISTORY_POINTS = 120;

function PowerHistory({ source, wide = false }: { source: GTPowerSource; wide?: boolean }) {
    const { nonce } = useGT();
    const { settings } = usePrefs();
    const [range, setRange] = useState<GTRange>("24h");
    const [customMinutes, setCustomMinutes] = useState(DEFAULT_CUSTOM_MINUTES);
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
            <div className="power-history__controls">
                <SegmentedControl<GTRange> options={HISTORY_RANGES} value={range} onChange={setRange} />
                {range === "custom" && <CustomRangeInput minutes={customMinutes} onChange={setCustomMinutes} />}
            </div>
            {history.error && <div className="power-history__note">Couldn't load history ({history.error}).</div>}
            {data && (
                <>
                    <span className="power-history__label">Stored</span>
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
                        ariaLabel={`${source.name}, stored EU`}
                    />
                    {capped && (
                        <div className="power-history__note">
                            Stored EU is past what the history can hold (9.2E EU), so the chart is flat at that cap.
                        </div>
                    )}
                    {net.some((v) => v !== null) && (
                        <>
                            <span className="power-history__label">Net EU/t (in − out)</span>
                            <Chart
                                values={net}
                                timestamps={timestamps}
                                range={range}
                                spanMillis={spanMillis}
                                width={wide ? HISTORY_W_WIDE : HISTORY_W}
                                height={wide ? 100 : 70}
                                showAxes
                                yTickCount={2}
                                formatValue={(v) => (v < 0 ? `−${formatEUt(-v)}` : formatEUt(v)).replace(" EU/t", "")}
                                ariaLabel={`${source.name}, net EU per tick`}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
}
