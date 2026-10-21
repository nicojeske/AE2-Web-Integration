// GregTech Machines section (docs/gt-hub/phase-2-frontend.md §4.1): every multiblock the server's last
// scan saw in one table, grouped by status (problems first, unloaded last) or by processing line, plus an
// inspector with the selected machine's settings, recipe and production. The data comes from `state/gt.tsx`'s app-wide poll, which also feeds the
// sidebar badge.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { getGTMachine, getGTProductionHistory } from "../api/client";
import { formatDuration, formatEUt, formatNumber, formatRelativeAge, gtTierName } from "../api/format";
import type { GTMachine, GTMachines, GTMachineStatus, GTProductionEntry, GTRange } from "../api/types";
import { GT_STATUS_ORDER } from "../api/types";
import { getContext } from "../context";
import { GT_PRODUCTION_POLL_MS, useGT, useGTPoll } from "../state/gt";
import { DEFAULT_MACHINE_FILTERS, usePrefs } from "../state/prefs";
import type { MachineFilters } from "../state/prefs";
import { useToast } from "../state/toast";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Chart } from "../ui/Chart";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { ChipMenu } from "../ui/ChipMenu";
import { Inspector } from "../ui/Inspector";
import { ItemIcon } from "../ui/ItemIcon";
import { ProgressBar } from "../ui/ProgressBar";
import { SectionLabel } from "../ui/SectionLabel";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { SegmentedOption } from "../ui/SegmentedControl";
import { GTPollState, RecipeCountdown, RecipePercent, useNow } from "./gtCommon";
import { RecipeDetail, RecipeTiles } from "./RecipeFlow";
import {
    coordsText,
    dimensionKey,
    filterMachines,
    formatGTAmount,
    formatGTPerHour,
    formatMicros,
    groupMachines,
    groupMachinesByLine,
    lineHealthText,
    GT_STATUS_LABELS,
    GT_STATUS_VARIANTS,
    gtRangeOptions,
    lineNames,
    machineLabel,
    pendingPassiveSuggestions,
    recipeClock,
    statusDuration,
} from "./gtModel";
import type { MachineGroup, MachineNaming } from "./gtModel";
import { pointTimestamps } from "./statsModel";

export interface MachinesProps {
    /** The machine in the inspector (`#/machines/<id>`), or `null`. */
    openId: string | null;
    onOpen: (id: string | null) => void;
}

export function Machines({ openId, onOpen }: MachinesProps) {
    const { machines } = useGT();
    return (
        <div className="page">
            <LineNameList />
            <div className="page__main machines">
                <GTPollState poll={machines} what="machines">
                    {(data) => <MachinesBody data={data} openId={openId} onOpen={onOpen} />}
                </GTPollState>
            </div>
            <Inspector
                label="Machine"
                width={400}
                open={openId !== null}
                onClose={() => onOpen(null)}
                placeholder="Select a machine to see its recipe, production and settings."
            >
                {openId !== null && (
                    <MachineInspector
                        key={openId}
                        id={openId}
                        listed={machines.data?.machines.find((m) => m.id === openId) ?? null}
                        scannedAt={machines.data?.scannedAt ?? null}
                        suggested={machines.data?.suggestedPassive?.includes(openId) ?? false}
                    />
                )}
            </Inspector>
        </div>
    );
}

function MachinesBody({
    data,
    openId,
    onOpen,
}: {
    data: GTMachines;
    openId: string | null;
    onOpen: (id: string) => void;
}) {
    const { machineFilters: filters, setMachineFilters, settings, passiveMachines } = usePrefs();
    const { machineNames, machineLines } = useGT();
    const [search, setSearch] = useState("");
    // The Passive group exists to get out of the way, so it starts every visit collapsed.
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(["passive"]));
    /** Machine ids picked in select mode; `null` while not selecting. */
    const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
    const [reviewOpen, setReviewOpen] = useState(false);
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
        <>
            <header className="page-header">
                <h2 className="page-header__title">Machines</h2>
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
                {data.unloaded > 0 && <span className="page-header__sub">{data.unloaded} not loaded</span>}
                <span className="page-header__end mono-count" title="Server-side cost of the last scan">
                    Scanned {formatRelativeAge(data.scannedAt, now)} · {formatMicros(data.scanMicros)}
                </span>
            </header>

            <div className="page-toolbar">
                <input
                    type="text"
                    className="field machines__search"
                    placeholder="Search name, line, recipe item, owner or x y z…"
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
                <SegmentedControl<MachineFilters["groupBy"]>
                    options={GROUP_BY_OPTIONS}
                    value={filters.groupBy}
                    onChange={(groupBy) => setMachineFilters((f) => ({ ...f, groupBy }))}
                />
                {dimensions.length > 1 && (
                    <ChipMenu<string | null>
                        options={[
                            { value: null, label: "All dimensions" },
                            ...dimensions.map((d) => ({ value: d, label: d })),
                        ]}
                        value={filters.dimension}
                        onChange={(dimension) => setMachineFilters((f) => ({ ...f, dimension }))}
                    />
                )}
                <Checkbox
                    checked={filters.showUnloaded}
                    onChange={(showUnloaded) => setMachineFilters((f) => ({ ...f, showUnloaded }))}
                >
                    Show unloaded
                </Checkbox>
                {filters.groupBy === "status" && (
                    <Checkbox
                        checked={filters.passiveProblems}
                        onChange={(passiveProblems) => setMachineFilters((f) => ({ ...f, passiveProblems }))}
                        title="Off keeps machines marked passive in the Passive group even when they need attention"
                    >
                        Show passive problems
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
                <div className="page-header__end">
                    {suggestions.length > 0 && filters.groupBy === "status" && (
                        <span className="machines__suggest">
                            {suggestions.length} look passive ·{" "}
                            <Button variant="text" aria-expanded={reviewOpen} onClick={() => setReviewOpen((o) => !o)}>
                                {reviewOpen ? "Hide" : "Review"}
                            </Button>
                        </span>
                    )}
                    <Button
                        variant={selection ? "primary" : "secondary"}
                        size="sm"
                        title="Pick several machines to put them on a processing line or mark them passive"
                        onClick={() => setSelection((sel) => (sel ? null : new Set()))}
                    >
                        {selection ? "Done" : "Select"}
                    </Button>
                </div>
            </div>

            {reviewOpen && suggestions.length > 0 && filters.groupBy === "status" && (
                <PassiveSuggestions machines={suggestions} onOpen={onOpen} />
            )}

            <div className={cx("page__scroll", selection && "machines__scroll--selecting")}>
                {groups.length === 0 ? (
                    <div className="placeholder-panel">No machines match these filters.</div>
                ) : (
                    <div className={cx("dtable mtable", selection && "mtable--select")}>
                        <div className="dtable__head">
                            {selection && <span />}
                            <span />
                            <span>Machine</span>
                            <span>Tier</span>
                            <span>Status</span>
                            <span className="right">EU/t</span>
                            <span className="right">Eff.</span>
                            <span>Recipe</span>
                        </div>
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
                                    {!isCollapsed &&
                                        group.machines.map((m) => (
                                            <MachineRow
                                                key={m.id}
                                                machine={m}
                                                naming={naming}
                                                showLine={filters.groupBy === "status"}
                                                scannedAt={data.scannedAt}
                                                now={now}
                                                numberFormat={settings.numberFormat}
                                                open={m.id === openId}
                                                selected={selection ? selection.has(m.id) : null}
                                                onOpen={() => (selection ? toggleSelected(m.id) : onOpen(m.id))}
                                            />
                                        ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {selection && <SelectionBar selection={selection} onClear={() => setSelection(new Set())} />}
        </>
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
    const { machineLines } = useGT();
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
    const { renameLine } = useGT();
    const [renaming, setRenaming] = useState(false);
    const health = group.health;
    const ids = group.machines.map((m) => m.id);
    const allSelected = selection !== null && ids.every((id) => selection.has(id));

    return (
        <div className="machines__group-head">
            {renaming && group.line !== undefined ? (
                <CommitInput
                    className="field machines__rename"
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
            {health && <span className="machines__line-health">{lineHealthText(health)}</span>}
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
    const { setPassive } = usePrefs();
    const { setMachineLine } = useGT();
    const [line, setLine] = useState("");
    const ids = [...selection];
    const none = ids.length === 0;
    return (
        <div className="machines__selection-bar" role="toolbar" aria-label="Selected machines">
            <span className="machines__selection-count">{none ? "Nothing selected" : `${ids.length} selected`}</span>
            <input
                type="text"
                className="field machines__line-input"
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
            <span className="machines__selection-hint">Click machines to add or remove them</span>
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

/** The server's "these look passive" candidates, each to mark passive or dismiss (the toolbar's Review). */
function PassiveSuggestions({ machines, onOpen }: { machines: GTMachine[]; onOpen: (id: string) => void }) {
    const { setPassive } = usePrefs();
    const { machineNames } = useGT();
    const n = machines.length;
    return (
        <div className="passive-suggestions">
            <div className="passive-suggestions__head">
                <span className="passive-suggestions__text">
                    {n === 1 ? "1 machine has" : `${n} machines have`} produced the same outputs steadily - mark{" "}
                    {n === 1 ? "it" : "them"} passive to tuck {n === 1 ? "it" : "them"} into the collapsed Passive
                    group?
                </span>
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

const STATUS_COLORS: Record<string, string> = {
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
    grey: "var(--text-dim)",
    teal: "var(--cyan)",
    purple: "var(--accent)",
};

function MachineRow({
    machine: m,
    naming,
    showLine,
    scannedAt,
    now,
    numberFormat,
    open,
    selected,
    onOpen,
}: {
    machine: GTMachine;
    naming: MachineNaming;
    /** Shows the machine's processing line as a tag (when not already grouped by it). */
    showLine: boolean;
    scannedAt: number;
    now: number;
    numberFormat: "full" | "compact";
    /** This machine is in the inspector. */
    open: boolean;
    /** Select mode: whether this row is picked; `null` outside select mode. */
    selected: boolean | null;
    onOpen: () => void;
}) {
    const nickname = naming.names[m.id];
    const line = showLine ? naming.lines[m.id] : undefined;
    const label = GT_STATUS_LABELS[m.status];
    const color = STATUS_COLORS[GT_STATUS_VARIANTS[m.status]] ?? "var(--text-dim)";
    const clock = recipeClock(m, scannedAt);
    const detail = m.statusDetail && m.statusDetail.toLowerCase() !== label.toLowerCase() ? m.statusDetail : null;
    const foreignOwner = m.ownerName !== null && m.ownerName !== getContext().username ? m.ownerName : null;
    const duration = m.loaded ? statusDuration(m, now) : null;
    const issues = m.maintenanceIssues.length > 0 ? `Needs: ${m.maintenanceIssues.join(", ")}` : null;
    const sub = [
        issues ?? detail,
        `${m.x} ${m.y} ${m.z}`,
        foreignOwner,
        m.loaded ? null : `last seen ${formatRelativeAge(m.lastSeenMillis, now)}`,
    ]
        .filter(Boolean)
        .join(" · ");
    const state = clock ? (
        <RecipeCountdown clocks={[clock]} suffix=" left" />
    ) : duration ? (
        `${label} · ${duration}`
    ) : (
        label
    );
    const barPct = m.maxProgressTicks > 0 ? (m.progressTicks / m.maxProgressTicks) * 100 : 100;

    return (
        <div
            className={cx(
                "dtable__row dtable__row--clickable mrow",
                !m.loaded && "mrow--unloaded",
                (open || selected === true) && "dtable__row--selected",
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
            {selected !== null && (
                <span className={cx("mrow__check", selected && "mrow__check--on")}>{selected ? "✓" : ""}</span>
            )}
            <span className="led" style={{ background: color }} />
            <div className="cell-stack">
                <div className="mrow__name-line">
                    <span className="cell-text" title={nickname ? `GregTech name: ${m.name}` : undefined}>
                        {nickname ?? m.name}
                    </span>
                    {line && <span className="mrow__line">{line}</span>}
                </div>
                <span className={cx("mrow__sub", issues && "amber")}>{sub}</span>
            </div>
            <span className="mrow__tier">{m.voltageTier >= 0 ? gtTierName(m.voltageTier) : "—"}</span>
            <div className="mrow__status">
                <span style={{ color: m.status === "RUNNING" ? "var(--text-secondary)" : color }}>{state}</span>
                <ProgressBar
                    className="mrow__bar"
                    percent={barPct}
                    cycle={clock}
                    height={3}
                    color={color}
                    animated={false}
                />
            </div>
            <span className={cx("cell-num", m.euPerTick < 0 && "green")}>
                {m.euPerTick === 0 ? "—" : m.euPerTick < 0 ? `+${formatEUt(-m.euPerTick)}` : formatEUt(m.euPerTick)}
            </span>
            <span className="cell-num dim">{Math.round(m.efficiency / 100)}%</span>
            <RecipeTiles inputs={m.inputs} outputs={m.outputs} numberFormat={numberFormat} />
        </div>
    );
}

const DRAWER_RANGES = gtRangeOptions(["1h", "24h", "7d", "30d"]);
const DRAWER_CHART_W = 380;
const DRAWER_CHART_POINTS = 48;

function MachineInspector({
    id,
    listed,
    scannedAt,
    suggested,
}: {
    id: string;
    /** This machine's entry in the app-wide `/gt/machines` poll - fresher than the inspector's own fetch. */
    listed: GTMachine | null;
    scannedAt: number | null;
    /** Whether the server suggests this machine as passive. */
    suggested: boolean;
}) {
    const { nonce, machineNames, setMachineName, machineLines, setMachineLine } = useGT();
    const { settings, passiveMachines, setPassive } = usePrefs();
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
            <p className="item-panel__empty">
                {detail.notAvailable
                    ? "GregTech data isn't available on this server."
                    : missing
                      ? "This machine no longer exists, or isn't visible to you."
                      : detail.error
                        ? `Couldn't load this machine (${detail.error}).`
                        : "Loading…"}
            </p>
        );
    }

    const clock = scannedAt !== null ? recipeClock(m, scannedAt) : null;
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
        ["Energy", m.euPerTick < 0 ? `+${formatEUt(-m.euPerTick)} (generating)` : formatEUt(m.euPerTick)],
        ["Voltage tier", gtTierName(m.voltageTier)],
        ...(m.maxParallels > 1 && m.parallels > 0
            ? ([["Parallels", `${formatNumber(m.parallels)} of ${formatNumber(m.maxParallels)}`]] as [string, string][])
            : []),
        ...(m.baseDurationTicks > 0 && m.maxProgressTicks > 0
            ? ([
                  [
                      "Speed-up",
                      `${(m.baseDurationTicks / m.maxProgressTicks).toFixed(1)}× faster than the base ${formatDuration(m.baseDurationTicks * 50)}`,
                  ],
              ] as [string, string][])
            : []),
        ["Efficiency", `${(m.efficiency / 100).toFixed(m.efficiency % 100 === 0 ? 0 : 1)}%`],
        ["Owner", m.ownerName ?? "Admin only"],
        ["Type", m.type],
        ...(machineNames[m.id] ? ([["GregTech name", m.name]] as [string, string][]) : []),
        ["Last seen", m.loaded ? "Loaded now" : formatRelativeAge(m.lastSeenMillis, now)],
    ];

    return (
        <div className="machine-panel">
            <div className="machine-panel__head">
                <div className="machine-panel__title-row">
                    <span className="machine-panel__title">{machineLabel(m, machineNames)}</span>
                    <Badge variant={GT_STATUS_VARIANTS[m.status]} size="sm">
                        {GT_STATUS_LABELS[m.status]}
                    </Badge>
                    {!m.loaded && (
                        <Badge variant="grey" size="sm">
                            Not loaded
                        </Badge>
                    )}
                    {isPassive && (
                        <Badge variant="grey" size="sm">
                            Passive
                        </Badge>
                    )}
                </div>
                <span className="machine-panel__where">
                    {m.x} {m.y} {m.z} · {dimensionKey(m)} ·{" "}
                    <Button variant="text" onClick={() => copyCoords(m)}>
                        copy
                    </Button>
                    ·{" "}
                    <Button variant="text" onClick={() => setPassive([m.id], isPassive ? null : true)}>
                        {isPassive ? "unmark passive" : "mark passive"}
                    </Button>
                </span>
            </div>
            {suggested && !(m.id in passiveMachines) && (
                <p className="item-panel__hint">
                    This machine has produced the same outputs steadily lately - it looks passive.
                </p>
            )}

            <div className="machine-panel__naming">
                <label className="machine-panel__label">
                    <span>Nickname</span>
                    <CommitInput
                        key={`name:${m.id}`}
                        className="field"
                        initial={machineNames[m.id] ?? ""}
                        placeholder={m.name}
                        ariaLabel="Nickname"
                        onCommit={(name) => setMachineName(m.id, name)}
                    />
                </label>
                <label className="machine-panel__label">
                    <span>Processing line</span>
                    <CommitInput
                        key={`line:${m.id}`}
                        className="field"
                        initial={machineLines[m.id] ?? ""}
                        placeholder="None"
                        ariaLabel="Processing line"
                        list={LINE_LIST_ID}
                        onCommit={(line) => setMachineLine([m.id], line)}
                    />
                </label>
                <p className="item-panel__hint machine-panel__naming-hint">
                    Shared with everyone who can see this machine.
                </p>
            </div>

            {clock && (
                <div className="machine-panel__progress">
                    <ProgressBar percent={0} cycle={clock} color="var(--green)" />
                    <div className="machine-panel__progress-label">
                        <span>
                            <RecipePercent clock={clock} />
                        </span>
                        <span>
                            <RecipeCountdown clocks={[clock]} suffix=" left" />
                        </span>
                    </div>
                </div>
            )}

            <div className="kv-grid machine-panel__fields">
                {fields.map(([k, v]) => (
                    <div key={k} className="kv-grid__cell">
                        <span className="kv-grid__key">{k}</span>
                        <span className="kv-grid__value" title={v}>
                            {v}
                        </span>
                    </div>
                ))}
            </div>

            {m.maintenanceIssues.length > 0 && (
                <div className="machine-panel__issues">
                    {m.maintenanceIssues.map((issue) => (
                        <Badge key={issue} variant="amber" size="sm">
                            {issue}
                        </Badge>
                    ))}
                </div>
            )}

            {m.outputs.length > 0 && (
                <section className="item-panel__section">
                    <SectionLabel>Current recipe</SectionLabel>
                    <RecipeDetail
                        inputs={m.inputs}
                        outputs={m.outputs}
                        progress={m.maxProgressTicks > 0 ? m.progressTicks / m.maxProgressTicks : 0}
                        clock={clock}
                        numberFormat={fmt}
                    />
                </section>
            )}

            <section className="item-panel__section">
                <SectionLabel
                    end={
                        <SegmentedControl<GTRange>
                            className="segmented--mono"
                            options={DRAWER_RANGES}
                            value={range}
                            onChange={setRange}
                        />
                    }
                >
                    Production
                </SectionLabel>
                {history.data && (
                    <Chart
                        variant="bars"
                        values={values}
                        timestamps={timestamps}
                        range={range}
                        width={DRAWER_CHART_W}
                        height={90}
                        numberFormat={fmt}
                        showAxes
                        ariaLabel={`${machineLabel(m, machineNames)}, total output per window`}
                    />
                )}
                {production === null ? (
                    <p className="item-panel__empty">
                        {detail.error ? `Couldn't load (${detail.error}).` : "Loading…"}
                    </p>
                ) : production.rows.length === 0 ? (
                    <p className="item-panel__empty">Nothing produced in this range.</p>
                ) : (
                    <FlowTable rows={production.rows} heading="Output" numberFormat={fmt} />
                )}
            </section>

            {consumption !== null && (
                <section className="item-panel__section">
                    <SectionLabel>Consumed</SectionLabel>
                    {consumption.rows.length === 0 ? (
                        <p className="item-panel__empty">No recipe inputs recorded in this range.</p>
                    ) : (
                        <FlowTable rows={consumption.rows} heading="Input" numberFormat={fmt} />
                    )}
                </section>
            )}
        </div>
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
