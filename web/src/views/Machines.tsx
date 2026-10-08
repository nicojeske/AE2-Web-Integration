// GregTech Machines section (docs/gt-hub/phase-2-frontend.md §4.1): every multiblock the server's last
// scan saw, grouped by status (problems first) with unloaded machines last, plus a detail drawer with
// that machine's production. The data comes from `state/gt.tsx`'s app-wide poll, which also feeds the
// sidebar badge.
import { useMemo, useState } from "preact/hooks";

import { getGTMachine, getGTProductionHistory } from "../api/client";
import { formatEUt, formatRelativeAge, gtTierName } from "../api/format";
import type { GTMachine, GTMachines, GTMachineStatus, GTRange } from "../api/types";
import { GT_STATUS_ORDER } from "../api/types";
import { getContext } from "../context";
import { GT_PRODUCTION_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { DEFAULT_MACHINE_FILTERS, usePrefs } from "../state/prefs";
import { useToast } from "../state/toast";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chart } from "../ui/Chart";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { Drawer } from "../ui/Drawer";
import { ItemIcon } from "../ui/ItemIcon";
import { ProgressBar } from "../ui/ProgressBar";
import { SegmentedControl } from "../ui/SegmentedControl";
import { GTPollState, useNow } from "./gtCommon";
import {
    coordsText,
    dimensionKey,
    filterMachines,
    formatGTAmount,
    formatGTPerHour,
    formatMicros,
    groupMachines,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    gtRangeOptions,
    liveProgressTicks,
    pendingPassiveSuggestions,
} from "./gtModel";
import { pointTimestamps } from "./statsModel";

export interface MachinesProps {
    /** The machine whose drawer is open (`#/machines/<id>`), or `null`. */
    openId: string | null;
    onOpen: (id: string | null) => void;
}

export function Machines({ openId, onOpen }: MachinesProps) {
    const { machines } = useGT();
    return (
        <>
            <GTPollState poll={machines} what="machines">
                {(data) => <MachinesBody data={data} onOpen={onOpen} />}
            </GTPollState>
            {openId !== null && (
                <MachineDrawer
                    id={openId}
                    listed={machines.data?.machines.find((m) => m.id === openId) ?? null}
                    scannedAt={machines.data?.scannedAt ?? null}
                    suggested={machines.data?.suggestedPassive?.includes(openId) ?? false}
                    onClose={() => onOpen(null)}
                />
            )}
        </>
    );
}

function MachinesBody({ data, onOpen }: { data: GTMachines; onOpen: (id: string) => void }) {
    const { machineFilters: filters, setMachineFilters, settings, passiveMachines } = usePrefs();
    const [search, setSearch] = useState("");
    // The Passive group exists to get out of the way, so it starts every visit collapsed.
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(["passive"]));
    const now = useNow(1000);

    const dimensions = useMemo(() => [...new Set(data.machines.map(dimensionKey))].sort(), [data.machines]);
    const groups = useMemo(
        () => groupMachines(filterMachines(data.machines, filters, search), passiveMachines),
        [data.machines, filters, search, passiveMachines],
    );
    const suggestions = useMemo(() => pendingPassiveSuggestions(data, passiveMachines), [data, passiveMachines]);

    if (data.machines.length === 0) {
        return (
            <div className="placeholder-panel">
                No GregTech multiblocks found yet. Machines appear within one scan of their chunk being loaded.
            </div>
        );
    }

    const toggleStatus = (status: GTMachineStatus) =>
        setMachineFilters((f) => ({
            ...f,
            statuses: f.statuses.includes(status) ? f.statuses.filter((s) => s !== status) : [...f.statuses, status],
        }));
    const filtersActive =
        search.trim() !== "" ||
        filters.statuses.length > 0 ||
        filters.dimension !== null ||
        filters.showUnloaded !== DEFAULT_MACHINE_FILTERS.showUnloaded;

    return (
        <section className="machines">
            <div className="machines__summary">
                {GT_STATUS_ORDER.filter((s) => data.summary[s] > 0 || filters.statuses.includes(s)).map((status) => (
                    <button
                        key={status}
                        type="button"
                        className={cx(
                            "machines__chip",
                            `machines__chip--${GT_STATUS_VARIANTS[status]}`,
                            filters.statuses.includes(status) && "machines__chip--active",
                        )}
                        aria-pressed={filters.statuses.includes(status)}
                        title={`Show only ${GT_STATUS_LABELS[status].toLowerCase()} machines (click again to clear)`}
                        onClick={() => toggleStatus(status)}
                    >
                        <span className="machines__chip-count">{data.summary[status]}</span>
                        {GT_STATUS_LABELS[status].toLowerCase()}
                    </button>
                ))}
                {data.unloaded > 0 && <span className="machines__unloaded-count">{data.unloaded} not loaded</span>}
                <span className="machines__scan" title="Server-side cost of the last scan">
                    Scanned {formatRelativeAge(data.scannedAt, now)} · {formatMicros(data.scanMicros)}
                </span>
            </div>

            <div className="machines__toolbar">
                <input
                    type="text"
                    className="gt-input machines__search"
                    placeholder="Search name, type, owner or x y z..."
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
                {dimensions.length > 1 && (
                    <select
                        className="gt-input"
                        aria-label="Dimension"
                        value={filters.dimension ?? ""}
                        onChange={(e) => {
                            const value = (e.target as HTMLSelectElement).value;
                            setMachineFilters((f) => ({ ...f, dimension: value === "" ? null : value }));
                        }}
                    >
                        <option value="">All dimensions</option>
                        {dimensions.map((d) => (
                            <option key={d} value={d}>
                                {d}
                            </option>
                        ))}
                    </select>
                )}
                <Checkbox
                    checked={filters.showUnloaded}
                    onChange={(showUnloaded) => setMachineFilters((f) => ({ ...f, showUnloaded }))}
                >
                    <span className="machines__toggle-label">Show unloaded</span>
                </Checkbox>
                {filtersActive && (
                    <Button
                        variant="text"
                        onClick={() => {
                            setSearch("");
                            setMachineFilters(() => DEFAULT_MACHINE_FILTERS);
                        }}
                    >
                        Clear filters
                    </Button>
                )}
            </div>

            {suggestions.length > 0 && <PassiveSuggestions machines={suggestions} onOpen={onOpen} />}

            {groups.length === 0 && <div className="placeholder-panel">No machines match these filters.</div>}

            {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                return (
                    <div key={group.key} className="machines__group">
                        <button
                            type="button"
                            className="machines__group-header"
                            aria-expanded={!isCollapsed}
                            onClick={() =>
                                setCollapsed((c) => {
                                    const next = new Set(c);
                                    if (!next.delete(group.key)) next.add(group.key);
                                    return next;
                                })
                            }
                        >
                            <span className={cx("machines__caret", isCollapsed && "machines__caret--collapsed")}>
                                ▾
                            </span>
                            {group.label}
                            <span className="machines__group-count">{group.machines.length}</span>
                        </button>
                        {!isCollapsed && (
                            <div
                                className="machines__grid"
                                style={{ "--tile-min": `${settings.tileMin + 80}px` } as Record<string, string>}
                            >
                                {group.machines.map((m) => (
                                    <MachineCard
                                        key={m.id}
                                        machine={m}
                                        scannedAt={data.scannedAt}
                                        now={now}
                                        numberFormat={settings.numberFormat}
                                        onOpen={() => onOpen(m.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </section>
    );
}

/** The server's "these look passive" candidates, each to mark passive or dismiss; collapsed to one line by default. */
function PassiveSuggestions({ machines, onOpen }: { machines: GTMachine[]; onOpen: (id: string) => void }) {
    const { setPassive } = usePrefs();
    const [open, setOpen] = useState(false);
    const n = machines.length;
    return (
        <div className="passive-suggestions">
            <div className="passive-suggestions__head">
                <span className="passive-suggestions__text">
                    {n === 1 ? "1 machine has" : `${n} machines have`} produced the same outputs steadily - mark{" "}
                    {n === 1 ? "it" : "them"} passive to tuck {n === 1 ? "it" : "them"} into the collapsed Passive
                    group?
                </span>
                <Button variant="text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                    {open ? "Hide" : "Review"}
                </Button>
                <Button
                    size="sm"
                    onClick={() =>
                        setPassive(
                            machines.map((m) => m.id),
                            true,
                        )
                    }
                >
                    Mark all passive
                </Button>
            </div>
            {open && (
                <ul className="passive-suggestions__list">
                    {machines.map((m) => (
                        <li key={m.id} className="passive-suggestions__row">
                            <button type="button" className="passive-suggestions__name" onClick={() => onOpen(m.id)}>
                                {m.name}
                            </button>
                            <span className="passive-suggestions__where">
                                {m.x}, {m.y}, {m.z} · {dimensionKey(m)}
                            </span>
                            <Button size="sm" onClick={() => setPassive([m.id], true)}>
                                Mark passive
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPassive([m.id], false)}>
                                Not passive
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Copies `x y z` (the form `/tp` takes); plain-HTTP pages have no clipboard API, so show them instead. */
function useCopyCoords(): (m: GTMachine) => void {
    const toast = useToast();
    return (m) => {
        const text = coordsText(m);
        if (!navigator.clipboard) {
            toast(`Coordinates: ${text}`);
            return;
        }
        navigator.clipboard.writeText(text).then(
            () => toast(`Copied ${text}`),
            () => toast(`Coordinates: ${text}`),
        );
    };
}

function remainingLabel(m: GTMachine, progressTicks: number): string {
    const seconds = Math.max(0, Math.ceil((m.maxProgressTicks - progressTicks) / 20));
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s left` : `${seconds}s left`;
}

function MachineCard({
    machine: m,
    scannedAt,
    now,
    numberFormat,
    onOpen,
}: {
    machine: GTMachine;
    scannedAt: number;
    now: number;
    numberFormat: "full" | "compact";
    onOpen: () => void;
}) {
    const copyCoords = useCopyCoords();
    const label = GT_STATUS_LABELS[m.status];
    const progress = liveProgressTicks(m, scannedAt, now);
    const showProgress = m.loaded && m.status === "RUNNING" && m.maxProgressTicks > 0;
    const detail = m.statusDetail && m.statusDetail.toLowerCase() !== label.toLowerCase() ? m.statusDetail : null;
    const foreignOwner = m.ownerName !== null && m.ownerName !== getContext().username ? m.ownerName : null;

    return (
        <Card
            clickable
            className={cx("machine-card", !m.loaded && "machine-card--unloaded")}
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                }
            }}
        >
            <div className="machine-card__head">
                <span className="machine-card__name">{m.name}</span>
                {m.voltageTier >= 0 && <span className="machine-card__tier">{gtTierName(m.voltageTier)}</span>}
                <Badge variant={GT_STATUS_VARIANTS[m.status]} size="sm" className="machine-card__badge">
                    {label}
                </Badge>
            </div>

            {detail && <div className="machine-card__detail">{detail}</div>}

            {showProgress && (
                <div className="machine-card__progress">
                    <ProgressBar percent={(progress / m.maxProgressTicks) * 100} color="var(--green)" />
                    <span className="machine-card__progress-label">{remainingLabel(m, progress)}</span>
                </div>
            )}

            {(m.euPerTick !== 0 || m.status === "RUNNING") && (
                <div className="machine-card__stats">
                    {m.euPerTick !== 0 && (
                        <span className={cx(m.euPerTick < 0 && "machine-card__generating")}>
                            {m.euPerTick < 0 ? `+${formatEUt(-m.euPerTick)}` : formatEUt(m.euPerTick)}
                        </span>
                    )}
                    <span title="Efficiency">{Math.round(m.efficiency / 100)}% eff.</span>
                </div>
            )}

            {m.maintenanceIssues.length > 0 && (
                <div className="machine-card__issues">
                    {m.maintenanceIssues.map((issue) => (
                        <span key={issue} className="machine-card__issue">
                            {issue}
                        </span>
                    ))}
                </div>
            )}

            {m.outputs.length > 0 && (
                <div className="machine-card__outputs">
                    {m.outputs.map((o) => (
                        <span key={o.id} className="machine-card__output" title={o.name}>
                            <ItemIcon itemid={o.id} name={o.name} size={20} />
                            {formatGTAmount(o.amount, o.fluid, numberFormat)}
                        </span>
                    ))}
                </div>
            )}

            <div className="machine-card__foot">
                <button
                    type="button"
                    className="machine-card__coords"
                    title="Copy coordinates"
                    onClick={(e) => {
                        e.stopPropagation();
                        copyCoords(m);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    {m.x}, {m.y}, {m.z}
                </button>
                <span>{dimensionKey(m)}</span>
                {foreignOwner && <span>{foreignOwner}</span>}
                {!m.loaded && <span>last seen {formatRelativeAge(m.lastSeenMillis, now)}</span>}
            </div>
        </Card>
    );
}

const DRAWER_RANGES = gtRangeOptions(["1h", "24h", "7d", "30d"]);
const DRAWER_CHART_W = 380;
const DRAWER_CHART_POINTS = 48;

function MachineDrawer({
    id,
    listed,
    scannedAt,
    suggested,
    onClose,
}: {
    id: string;
    /** This machine's entry in the app-wide `/gt/machines` poll - fresher than the drawer's own fetch. */
    listed: GTMachine | null;
    scannedAt: number | null;
    /** Whether the server suggests this machine as passive. */
    suggested: boolean;
    onClose: () => void;
}) {
    const { nonce } = useGT();
    const { settings, passiveMachines, setPassive } = usePrefs();
    const copyCoords = useCopyCoords();
    const now = useNow(1000);
    const [range, setRange] = useState<GTRange>("24h");
    const key = `${id}|${range}`;
    const detail = useGTPoll(() => getGTMachine(id, range), GT_PRODUCTION_POLL_MS, key, nonce);
    const history = useGTPoll(
        () => getGTProductionHistory({ machine: id, range, points: DRAWER_CHART_POINTS }),
        GT_PRODUCTION_POLL_MS,
        key,
        nonce,
    );

    const m = listed ?? detail.data?.machine ?? null;
    const fmt = settings.numberFormat;
    const isPassive = passiveMachines[id] === true;

    if (!m) {
        const missing = detail.error === "NOT_FOUND";
        return (
            <Drawer title="Machine" onClose={onClose}>
                <div className="placeholder-panel">
                    {detail.notAvailable
                        ? "GregTech data isn't available on this server."
                        : missing
                          ? "This machine no longer exists, or isn't visible to you."
                          : detail.error
                            ? `Couldn't load this machine (${detail.error}).`
                            : "Loading…"}
                </div>
            </Drawer>
        );
    }

    const progress = scannedAt !== null ? liveProgressTicks(m, scannedAt, now) : m.progressTicks;
    const production = detail.data?.production ?? null;
    const values = history.data?.points ?? [];
    const timestamps = history.data ? pointTimestamps(history.data.from, history.data.stepMillis, values.length) : [];

    const fields: [string, string][] = [
        ["Status", m.statusDetail ? `${GT_STATUS_LABELS[m.status]} - ${m.statusDetail}` : GT_STATUS_LABELS[m.status]],
        ...(m.status === "RUNNING" && m.maxProgressTicks > 0
            ? ([
                  [
                      "Progress",
                      `${Math.round((progress / m.maxProgressTicks) * 100)}% · ${remainingLabel(m, progress)}`,
                  ],
              ] as [string, string][])
            : []),
        ["Energy", m.euPerTick < 0 ? `+${formatEUt(-m.euPerTick)} (generating)` : formatEUt(m.euPerTick)],
        ["Voltage tier", gtTierName(m.voltageTier)],
        ["Efficiency", `${(m.efficiency / 100).toFixed(m.efficiency % 100 === 0 ? 0 : 1)}%`],
        ["Owner", m.ownerName ?? "Admin only"],
        ["Type", m.type],
        ["Last seen", m.loaded ? "Loaded now" : formatRelativeAge(m.lastSeenMillis, now)],
    ];

    return (
        <Drawer title={m.name} subtitle={`${m.x}, ${m.y}, ${m.z} · ${dimensionKey(m)}`} onClose={onClose}>
            <div className="machine-drawer__status">
                <Badge variant={GT_STATUS_VARIANTS[m.status]}>{GT_STATUS_LABELS[m.status]}</Badge>
                {!m.loaded && <Badge variant="grey">Not loaded</Badge>}
                {isPassive && <Badge variant="grey">Passive</Badge>}
                <Button variant="text" onClick={() => copyCoords(m)}>
                    Copy coordinates
                </Button>
                <Button variant="text" onClick={() => setPassive([m.id], isPassive ? null : true)}>
                    {isPassive ? "Unmark passive" : "Mark as passive"}
                </Button>
            </div>
            {suggested && !(m.id in passiveMachines) && (
                <div className="machine-drawer__hint">
                    This machine has produced the same outputs steadily lately - it looks passive.
                </div>
            )}
            {m.status === "RUNNING" && m.maxProgressTicks > 0 && (
                <ProgressBar percent={(progress / m.maxProgressTicks) * 100} color="var(--green)" />
            )}

            <dl className="machine-drawer__fields">
                {fields.map(([k, v]) => (
                    <div key={k} className="machine-drawer__field">
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                    </div>
                ))}
            </dl>

            {m.maintenanceIssues.length > 0 && (
                <div className="machine-card__issues">
                    {m.maintenanceIssues.map((issue) => (
                        <span key={issue} className="machine-card__issue">
                            {issue}
                        </span>
                    ))}
                </div>
            )}

            {m.outputs.length > 0 && (
                <>
                    <h3 className="machine-drawer__heading">Current recipe</h3>
                    <div className="machine-card__outputs">
                        {m.outputs.map((o) => (
                            <span key={o.id} className="machine-card__output">
                                <ItemIcon itemid={o.id} name={o.name} size={20} />
                                {formatGTAmount(o.amount, o.fluid, fmt)} {o.name}
                            </span>
                        ))}
                    </div>
                </>
            )}

            <div className="machine-drawer__production-head">
                <h3 className="machine-drawer__heading">Production</h3>
                <SegmentedControl<GTRange> options={DRAWER_RANGES} value={range} onChange={setRange} />
            </div>
            {history.data && (
                <Chart
                    variant="bars"
                    values={values}
                    timestamps={timestamps}
                    range={range}
                    width={DRAWER_CHART_W}
                    height={110}
                    numberFormat={fmt}
                    showAxes
                    ariaLabel={`${m.name}, total output per window`}
                />
            )}
            {production === null ? (
                <div className="machine-drawer__empty">
                    {detail.error ? `Couldn't load (${detail.error}).` : "Loading…"}
                </div>
            ) : production.rows.length === 0 ? (
                <div className="machine-drawer__empty">Nothing produced in this range.</div>
            ) : (
                <table className="gt-table">
                    <thead>
                        <tr>
                            <th>Output</th>
                            <th className="gt-table__num">Total</th>
                            <th className="gt-table__num">Per hour</th>
                        </tr>
                    </thead>
                    <tbody>
                        {production.rows.map((row) => (
                            <tr key={row.key}>
                                <td>
                                    <span className="gt-table__item">
                                        <ItemIcon itemid={row.key} name={row.name} size={20} />
                                        {row.name}
                                    </span>
                                </td>
                                <td className="gt-table__num">{formatGTAmount(row.total, row.fluid, fmt)}</td>
                                <td className="gt-table__num">{formatGTPerHour(row.perHour, row.fluid, fmt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Drawer>
    );
}
