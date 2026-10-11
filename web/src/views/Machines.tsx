// GregTech Machines section (docs/gt-hub/phase-2-frontend.md §4.1): every multiblock the server's last
// scan saw, grouped by status (problems first) with unloaded machines last, plus a detail drawer with
// that machine's production. The data comes from `state/gt.tsx`'s app-wide poll, which also feeds the
// sidebar badge.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { getGTMachine, getGTProductionHistory } from "../api/client";
import { formatEUt, formatRelativeAge, gtTierName } from "../api/format";
import type { GTMachine, GTMachines, GTMachineStatus, GTProductionEntry, GTRange } from "../api/types";
import { GT_STATUS_ORDER } from "../api/types";
import { getContext } from "../context";
import { GT_PRODUCTION_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { DEFAULT_MACHINE_FILTERS, usePrefs } from "../state/prefs";
import type { MachineFilters } from "../state/prefs";
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
import type { SegmentedOption } from "../ui/SegmentedControl";
import { GTPollState, useNow } from "./gtCommon";
import { RecipeDetail, RecipeStrip } from "./RecipeFlow";
import {
    coordsText,
    dimensionKey,
    filterMachines,
    formatGTAmount,
    formatGTPerHour,
    formatMicros,
    groupMachines,
    groupMachinesByLine,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    gtRangeOptions,
    lineNames,
    liveProgressTicks,
    machineLabel,
    pendingPassiveSuggestions,
    remainingLabel,
    statusDuration,
} from "./gtModel";
import type { MachineGroup, MachineNaming } from "./gtModel";
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
            <LineNameList />
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
    const {
        machineFilters: filters,
        setMachineFilters,
        settings,
        passiveMachines,
        machineNames,
        machineLines,
    } = usePrefs();
    const [search, setSearch] = useState("");
    // The Passive group exists to get out of the way, so it starts every visit collapsed.
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(["passive"]));
    /** Machine ids picked in select mode; `null` while not selecting. */
    const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
    const now = useNow(1000);

    const naming = useMemo(() => ({ names: machineNames, lines: machineLines }), [machineNames, machineLines]);
    const dimensions = useMemo(() => [...new Set(data.machines.map(dimensionKey))].sort(), [data.machines]);
    const groups = useMemo(() => {
        const shown = filterMachines(data.machines, filters, search, naming);
        return filters.groupBy === "line"
            ? groupMachinesByLine(shown, naming)
            : groupMachines(shown, passiveMachines, filters.passiveProblems);
    }, [data.machines, filters, search, naming, passiveMachines]);
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
    const toggleSelected = (id: string) =>
        setSelection((sel) => {
            const next = new Set(sel);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    const filtersActive =
        search.trim() !== "" ||
        filters.statuses.length > 0 ||
        filters.dimension !== null ||
        filters.showUnloaded !== DEFAULT_MACHINE_FILTERS.showUnloaded ||
        filters.passiveProblems !== DEFAULT_MACHINE_FILTERS.passiveProblems;

    return (
        <section className={cx("machines", selection && "machines--selecting")}>
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
                    placeholder="Search name, line, recipe item, owner or x y z..."
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
                <SegmentedControl<MachineFilters["groupBy"]>
                    options={GROUP_BY_OPTIONS}
                    value={filters.groupBy}
                    onChange={(groupBy) => setMachineFilters((f) => ({ ...f, groupBy }))}
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
                {filters.groupBy === "status" && (
                    <Checkbox
                        checked={filters.passiveProblems}
                        onChange={(passiveProblems) => setMachineFilters((f) => ({ ...f, passiveProblems }))}
                    >
                        <span
                            className="machines__toggle-label"
                            title="Off keeps machines marked passive in the Passive group even when they need attention"
                        >
                            Show passive problems
                        </span>
                    </Checkbox>
                )}
                {filtersActive && (
                    <Button
                        variant="text"
                        onClick={() => {
                            setSearch("");
                            setMachineFilters((f) => ({ ...DEFAULT_MACHINE_FILTERS, groupBy: f.groupBy }));
                        }}
                    >
                        Clear filters
                    </Button>
                )}
                <Button
                    variant={selection ? "primary" : "secondary"}
                    size="sm"
                    className="machines__select-toggle"
                    title="Pick several machines to put them on a processing line or mark them passive"
                    onClick={() => setSelection((sel) => (sel ? null : new Set()))}
                >
                    {selection ? "Done" : "Select"}
                </Button>
            </div>

            {suggestions.length > 0 && filters.groupBy === "status" && (
                <PassiveSuggestions machines={suggestions} onOpen={onOpen} />
            )}

            {groups.length === 0 && <div className="placeholder-panel">No machines match these filters.</div>}

            {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                return (
                    <div key={group.key} className="machines__group">
                        <GroupHeader
                            group={group}
                            collapsed={isCollapsed}
                            onToggle={() =>
                                setCollapsed((c) => {
                                    const next = new Set(c);
                                    if (!next.delete(group.key)) next.add(group.key);
                                    return next;
                                })
                            }
                            selection={selection}
                            onSelectAll={(ids, on) =>
                                setSelection((sel) => {
                                    const next = new Set(sel);
                                    for (const id of ids) {
                                        if (on) next.add(id);
                                        else next.delete(id);
                                    }
                                    return next;
                                })
                            }
                        />
                        {!isCollapsed && (
                            <div
                                className="machines__grid"
                                style={{ "--tile-min": `${settings.tileMin + 80}px` } as Record<string, string>}
                            >
                                {group.machines.map((m) => (
                                    <MachineCard
                                        key={m.id}
                                        machine={m}
                                        naming={naming}
                                        showLine={filters.groupBy === "status"}
                                        scannedAt={data.scannedAt}
                                        now={now}
                                        numberFormat={settings.numberFormat}
                                        selected={selection ? selection.has(m.id) : null}
                                        onOpen={() => (selection ? toggleSelected(m.id) : onOpen(m.id))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {selection && <SelectionBar selection={selection} onClear={() => setSelection(new Set())} />}
        </section>
    );
}

const GROUP_BY_OPTIONS: SegmentedOption<MachineFilters["groupBy"]>[] = [
    { value: "status", label: "By status" },
    { value: "line", label: "By line" },
];

/** Shared `<datalist>` id offering the existing processing line names to every line input. */
const LINE_LIST_ID = "gt-line-names";

/** The `<datalist>` behind `LINE_LIST_ID`; rendered once by `Machines`. */
function LineNameList() {
    const { machineLines } = usePrefs();
    return (
        <datalist id={LINE_LIST_ID}>
            {lineNames(machineLines).map((line) => (
                <option key={line} value={line} />
            ))}
        </datalist>
    );
}

function GroupHeader({
    group,
    collapsed,
    onToggle,
    selection,
    onSelectAll,
}: {
    group: MachineGroup;
    collapsed: boolean;
    onToggle: () => void;
    selection: ReadonlySet<string> | null;
    onSelectAll: (ids: string[], on: boolean) => void;
}) {
    const { renameLine } = usePrefs();
    const [renaming, setRenaming] = useState(false);
    const health = group.health;
    const ids = group.machines.map((m) => m.id);
    const allSelected = selection !== null && ids.every((id) => selection.has(id));

    return (
        <div className="machines__group-head">
            {renaming && group.line !== undefined ? (
                <CommitInput
                    className="gt-input machines__rename"
                    initial={group.line}
                    ariaLabel="Line name"
                    autoFocus
                    onCommit={(name) => {
                        if (name.trim() !== "") renameLine(group.line!, name);
                        setRenaming(false);
                    }}
                    onCancel={() => setRenaming(false)}
                />
            ) : (
                <button type="button" className="machines__group-header" aria-expanded={!collapsed} onClick={onToggle}>
                    <span className={cx("machines__caret", collapsed && "machines__caret--collapsed")}>▾</span>
                    {health?.worst && (
                        <span
                            className={`machines__dot machines__dot--${GT_STATUS_VARIANTS[health.worst]}`}
                            title={GT_STATUS_LABELS[health.worst]}
                        />
                    )}
                    {group.label}
                    <span className="machines__group-count">{group.machines.length}</span>
                </button>
            )}
            {health && (
                <span className="machines__line-health">
                    {health.counts.map(([status, n]) => `${n} ${GT_STATUS_LABELS[status].toLowerCase()}`).join(" · ")}
                    {health.euPerTick !== 0 &&
                        ` · ${health.euPerTick < 0 ? `+${formatEUt(-health.euPerTick)}` : formatEUt(health.euPerTick)}`}
                </span>
            )}
            {group.line !== undefined && !renaming && (
                <Button variant="text" size="sm" onClick={() => setRenaming(true)}>
                    Rename
                </Button>
            )}
            {selection && ids.length > 0 && (
                <Button variant="text" size="sm" onClick={() => onSelectAll(ids, !allSelected)}>
                    {allSelected ? "Deselect group" : "Select group"}
                </Button>
            )}
        </div>
    );
}

/** The sticky bar of select mode: put the picked machines on a line, take them off, or mark them passive. */
function SelectionBar({ selection, onClear }: { selection: ReadonlySet<string>; onClear: () => void }) {
    const { setMachineLine, setPassive } = usePrefs();
    const [line, setLine] = useState("");
    const ids = [...selection];
    const none = ids.length === 0;
    return (
        <div className="machines__selection-bar" role="toolbar" aria-label="Selected machines">
            <span className="machines__selection-count">
                {none ? "Click machines to select them" : `${ids.length} selected`}
            </span>
            <input
                type="text"
                className="gt-input machines__line-input"
                list={LINE_LIST_ID}
                placeholder="Line name"
                aria-label="Processing line"
                value={line}
                onInput={(e) => setLine((e.target as HTMLInputElement).value)}
            />
            <Button
                size="sm"
                disabled={none || line.trim() === ""}
                onClick={() => {
                    setMachineLine(ids, line);
                    onClear();
                }}
            >
                Add to line
            </Button>
            <Button
                size="sm"
                variant="secondary"
                disabled={none}
                onClick={() => {
                    setMachineLine(ids, null);
                    onClear();
                }}
            >
                Remove from line
            </Button>
            <Button
                size="sm"
                variant="secondary"
                disabled={none}
                onClick={() => {
                    setPassive(ids, true);
                    onClear();
                }}
            >
                Mark passive
            </Button>
        </div>
    );
}

/**
 * A text input that keeps its own draft and reports it once, on Enter or blur - so a nickname or line isn't
 * rewritten (and synced) on every keystroke. Escape reverts.
 */
function CommitInput({
    initial,
    onCommit,
    onCancel,
    className,
    placeholder,
    ariaLabel,
    list,
    autoFocus,
}: {
    initial: string;
    onCommit: (value: string) => void;
    onCancel?: () => void;
    className?: string;
    placeholder?: string;
    ariaLabel: string;
    list?: string;
    autoFocus?: boolean;
}) {
    const [draft, setDraft] = useState(initial);
    const done = useRef(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => setDraft(initial), [initial]);
    useEffect(() => {
        if (autoFocus) input.current?.focus();
    }, []);
    const commit = () => {
        if (done.current) return;
        if (draft.trim() !== initial.trim()) onCommit(draft);
        else onCancel?.();
    };
    return (
        <input
            type="text"
            className={className}
            placeholder={placeholder}
            aria-label={ariaLabel}
            list={list}
            value={draft}
            ref={input}
            onInput={(e) => {
                done.current = false;
                setDraft((e.target as HTMLInputElement).value);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    commit();
                    done.current = true;
                    (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                    e.stopPropagation();
                    done.current = true;
                    setDraft(initial);
                    onCancel?.();
                    (e.target as HTMLInputElement).blur();
                }
            }}
            onBlur={() => {
                commit();
                done.current = false;
            }}
        />
    );
}

/** The server's "these look passive" candidates, each to mark passive or dismiss; collapsed to one line by default. */
function PassiveSuggestions({ machines, onOpen }: { machines: GTMachine[]; onOpen: (id: string) => void }) {
    const { setPassive, machineNames } = usePrefs();
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
                                {machineLabel(m, machineNames)}
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

function MachineCard({
    machine: m,
    naming,
    showLine,
    scannedAt,
    now,
    numberFormat,
    selected,
    onOpen,
}: {
    machine: GTMachine;
    naming: MachineNaming;
    /** Shows the machine's processing line in the footer (when not already grouped by it). */
    showLine: boolean;
    scannedAt: number;
    now: number;
    numberFormat: "full" | "compact";
    /** Select mode: whether this card is picked; `null` outside select mode. */
    selected: boolean | null;
    onOpen: () => void;
}) {
    const nickname = naming.names[m.id];
    const line = showLine ? naming.lines[m.id] : undefined;
    const copyCoords = useCopyCoords();
    const label = GT_STATUS_LABELS[m.status];
    const progress = liveProgressTicks(m, scannedAt, now);
    const showProgress = m.loaded && m.status === "RUNNING" && m.maxProgressTicks > 0;
    const detail = m.statusDetail && m.statusDetail.toLowerCase() !== label.toLowerCase() ? m.statusDetail : null;
    const foreignOwner = m.ownerName !== null && m.ownerName !== getContext().username ? m.ownerName : null;
    const duration = m.loaded ? statusDuration(m, now) : null;

    return (
        <Card
            clickable
            className={cx(
                "machine-card",
                !m.loaded && "machine-card--unloaded",
                selected === true && "machine-card--selected",
            )}
            role={selected === null ? "button" : "checkbox"}
            aria-checked={selected ?? undefined}
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
                {selected !== null && (
                    <input type="checkbox" className="machine-card__check" checked={selected} tabIndex={-1} readOnly />
                )}
                <span className="machine-card__name" title={nickname ? m.name : undefined}>
                    {nickname ?? m.name}
                </span>
                {m.voltageTier >= 0 && <span className="machine-card__tier">{gtTierName(m.voltageTier)}</span>}
                <Badge variant={GT_STATUS_VARIANTS[m.status]} size="sm" className="machine-card__badge">
                    {label}
                </Badge>
                {duration && (
                    <span className="machine-card__since" title={`${label} for ${duration}`}>
                        {duration}
                    </span>
                )}
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

            <RecipeStrip
                inputs={m.inputs}
                outputs={m.outputs}
                progress={m.maxProgressTicks > 0 ? progress / m.maxProgressTicks : 0}
                numberFormat={numberFormat}
            />

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
                {line && <span className="machine-card__line">{line}</span>}
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
    const { settings, passiveMachines, setPassive, machineNames, setMachineName, machineLines, setMachineLine } =
        usePrefs();
    const copyCoords = useCopyCoords();
    const now = useNow(1000);
    const [range, setRange] = useState<GTRange>("24h");
    const key = `${id}|${range}`;
    const detail = useGTPoll(() => getGTMachine(id, range), GT_PRODUCTION_POLL_MS, key, nonce);
    const history = useGTPoll(
        () => getGTProductionHistory({ machine: id, flow: "produced", range, points: DRAWER_CHART_POINTS }),
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
    const consumption = detail.data?.consumption ?? null;
    const values = history.data?.points ?? [];
    const timestamps = history.data ? pointTimestamps(history.data.from, history.data.stepMillis, values.length) : [];

    const duration = statusDuration(m, now);
    const statusText = m.statusDetail
        ? `${GT_STATUS_LABELS[m.status]} - ${m.statusDetail}`
        : GT_STATUS_LABELS[m.status];
    const fields: [string, string][] = [
        ["Status", duration ? `${statusText} (for ${duration})` : statusText],
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
        ...(machineNames[m.id] ? ([["Name", m.name]] as [string, string][]) : []),
        ["Owner", m.ownerName ?? "Admin only"],
        ["Type", m.type],
        ["Last seen", m.loaded ? "Loaded now" : formatRelativeAge(m.lastSeenMillis, now)],
    ];

    return (
        <Drawer
            title={machineLabel(m, machineNames)}
            subtitle={`${m.x}, ${m.y}, ${m.z} · ${dimensionKey(m)}`}
            onClose={onClose}
        >
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

            <div className="machine-drawer__naming">
                <label className="machine-drawer__label">
                    <span>Nickname</span>
                    <CommitInput
                        key={`name:${m.id}`}
                        className="gt-input"
                        initial={machineNames[m.id] ?? ""}
                        placeholder={m.name}
                        ariaLabel="Nickname"
                        onCommit={(name) => setMachineName(m.id, name)}
                    />
                </label>
                <label className="machine-drawer__label">
                    <span>Processing line</span>
                    <CommitInput
                        key={`line:${m.id}`}
                        className="gt-input"
                        initial={machineLines[m.id] ?? ""}
                        placeholder="None"
                        ariaLabel="Processing line"
                        list={LINE_LIST_ID}
                        onCommit={(line) => setMachineLine([m.id], line)}
                    />
                </label>
            </div>

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
                    <RecipeDetail
                        inputs={m.inputs}
                        outputs={m.outputs}
                        progress={m.maxProgressTicks > 0 ? progress / m.maxProgressTicks : 0}
                        numberFormat={fmt}
                    />
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
                    ariaLabel={`${machineLabel(m, machineNames)}, total output per window`}
                />
            )}
            {production === null ? (
                <div className="machine-drawer__empty">
                    {detail.error ? `Couldn't load (${detail.error}).` : "Loading…"}
                </div>
            ) : production.rows.length === 0 ? (
                <div className="machine-drawer__empty">Nothing produced in this range.</div>
            ) : (
                <FlowTable rows={production.rows} heading="Output" numberFormat={fmt} />
            )}

            {consumption !== null && (
                <>
                    <h3 className="machine-drawer__heading">Consumed</h3>
                    {consumption.rows.length === 0 ? (
                        <div className="machine-drawer__empty">No recipe inputs recorded in this range.</div>
                    ) : (
                        <FlowTable rows={consumption.rows} heading="Input" numberFormat={fmt} />
                    )}
                </>
            )}
        </Drawer>
    );
}

function FlowTable({
    rows,
    heading,
    numberFormat,
}: {
    rows: GTProductionEntry[];
    heading: string;
    numberFormat: "full" | "compact";
}) {
    return (
        <table className="gt-table">
            <thead>
                <tr>
                    <th>{heading}</th>
                    <th className="gt-table__num">Total</th>
                    <th className="gt-table__num">Per hour</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.key}>
                        <td>
                            <span className="gt-table__item">
                                <ItemIcon itemid={row.key} name={row.name} size={20} />
                                {row.name}
                            </span>
                        </td>
                        <td className="gt-table__num">{formatGTAmount(row.total, row.fluid, numberFormat)}</td>
                        <td className="gt-table__num">{formatGTPerHour(row.perHour, row.fluid, numberFormat)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
