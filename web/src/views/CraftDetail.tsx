import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, cancelCpu } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { GridKey, ResourceRef } from "../api/types";
import { craftedPerMinute, craftTotals } from "../state/craftProgress";
import type { ProgressSample } from "../state/craftProgress";
import { useCpus } from "../state/cpus";
import type { CpuView } from "../state/cpus";
import { useFastMachinesPoll, useGT } from "../state/gt";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { usePrefs } from "../state/prefs";
import { useToast } from "../state/toast";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { ChipMenu } from "../ui/ChipMenu";
import { cpuLedColor, cpuRank } from "../ui/CpuLeds";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { Modal } from "../ui/Modal";
import { SegBar } from "../ui/SegBar";
import { ItemIcon } from "../ui/ItemIcon";
import { ConsumedSection, StepTable, WorkingMachines } from "./craftDetailParts";
import type { StepSortKey, WorkingMachinesGT } from "./craftDetailParts";
import { buildActiveCraftDetail, isJobFinished, snapshotOf } from "./craftDetailModel";
import { matchGTMachines } from "./craftMachinesModel";
import type { CraftDetailSnapshot, CraftStepRow, StepStage } from "./craftDetailModel";
import { JobItemDetail } from "./JobItemDetail";

/** Progress readings kept for the recent-rate ETA and the throughput chart (one per poll, ~2.5-5 s apart). */
const MAX_SAMPLES = 720;

export interface CraftDetailProps {
    gridKey: GridKey;
    cpuKey: string;
    onClose: () => void;
    /** Another CPU's Craft Detail (the tab strip). */
    onOpenCpu: (gridKey: GridKey, cpuKey: string) => void;
}

export function CraftDetail({ gridKey, cpuKey, onClose, onOpenCpu }: CraftDetailProps) {
    const { cpus, suppressCompletion, refresh } = useCpus();
    const { selected } = useNetwork();
    const toast = useToast();
    const { startOrder } = useOrder();

    const [now, setNow] = useState(Date.now());
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [filter, setFilter] = useState("");
    const [grouped, setGrouped] = useState(true);
    // Done grows all job long and is the least interesting group while it runs.
    const [hidden, setHidden] = useState<StepStage[]>(["done"]);
    const [sort, setSort] = useState<{ key: StepSortKey; desc: boolean }>({ key: "time", desc: true });
    const [openItem, setOpenItem] = useState<ResourceRef | null>(null);

    // Counts Elapsed/ETA up between polls (the poll cadence is 2.5s/5s; this ticks every 1s), mirroring
    // the poller's own document.hidden pause so a backgrounded tab doesn't keep a timer running.
    useEffect(() => {
        const id = setInterval(() => {
            if (!document.hidden) setNow(Date.now());
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const live = cpus.find((c) => c.sourceGridKey === gridKey && c.cpuKey === cpuKey) ?? null;

    // Freezes the last-known busy state so the page can render "Took"/"Completed" once the CPU goes
    // idle or drops out of `/list` entirely, instead of collapsing to nothing the instant it finishes -
    // mutating a ref during render (not in an effect) keeps this in lockstep with `live` every render,
    // with no extra render of its own since refs don't trigger one.
    const snapshotRef = useRef<CraftDetailSnapshot | null>(null);
    if (live?.isBusy) {
        const snap = snapshotOf(live, now);
        if (snap) snapshotRef.current = snap;
    }

    // One reading per fresh detail, on the server's elapsed clock so poll jitter doesn't skew the rate. Only
    // what this page has seen - the server keeps no progress history - and reset if the CPU starts a new job.
    const samplesRef = useRef<{ started: number; samples: ProgressSample[] }>({ started: 0, samples: [] });
    const detail = live?.isBusy ? live.detail : null;
    if (detail?.items && detail.hasTrackingInfo) {
        const kept = samplesRef.current;
        if (kept.started !== detail.timeStarted) samplesRef.current = { started: detail.timeStarted, samples: [] };
        const samples = samplesRef.current.samples;
        const last = samples[samples.length - 1];
        if (!last || detail.timeElapsed > last.elapsed) {
            samples.push({ elapsed: detail.timeElapsed, crafted: craftTotals(detail.items).crafted });
            if (samples.length > MAX_SAMPLES) samples.shift();
        }
    }
    const samples = samplesRef.current.samples;

    const view = buildActiveCraftDetail(live, snapshotRef.current, now, samples);
    const cpuName = live?.name ?? snapshotRef.current?.cpuName ?? "this CPU";
    const finished = isJobFinished(live);

    // GregTech machines running the recipes this job's providers owe - see craftMachinesModel.ts.
    const gt = useGT();
    const { passiveMachines, settings } = usePrefs();
    const { machineNames } = gt;
    const providers = live?.detail?.machines;
    const gtMachines = gt.machines.data;
    const matches = useMemo(
        () => (gt.enabled && providers ? matchGTMachines(providers, gtMachines, passiveMachines) : null),
        [gt.enabled, providers, gtMachines, passiveMachines],
    );
    const workingGT: WorkingMachinesGT | null =
        matches && gtMachines
            ? { matches, names: machineNames, scannedAt: gtMachines.scannedAt, numberFormat: settings.numberFormat }
            : null;
    useFastMachinesPoll(gt.enabled && !finished && (providers?.length ?? 0) > 0);

    const onConfirmCancel = async () => {
        setCancelling(true);
        try {
            await cancelCpu(gridKey, cpuKey);
            suppressCompletion(gridKey, cpuKey);
            toast(`Job cancelled on ${cpuName}`);
            setConfirmOpen(false);
            onClose();
            await refresh();
        } catch (e) {
            if (e instanceof ApiError && e.status === "CPU_NOT_BUSY") {
                // Benign race: the job finished between the last poll and the click.
                toast("That job already finished");
                setConfirmOpen(false);
                onClose();
                await refresh();
            } else {
                toast(e instanceof ApiError ? e.status : "Failed to cancel job");
            }
        } finally {
            setCancelling(false);
        }
    };

    const header = (
        <CpuTabs
            gridKey={gridKey}
            cpuKey={cpuKey}
            onBack={onClose}
            onOpen={(cpu) => onOpenCpu(cpu.sourceGridKey, cpu.cpuKey)}
        />
    );

    if (!view) {
        return (
            <div className="page craft">
                <div className="page__main">
                    {header}
                    {finished ? (
                        // No snapshot was ever captured (the job finished between the click and the first detail).
                        <div className="placeholder-panel">
                            <p>This job finished - {cpuName} is idle again.</p>
                            <Button variant="secondary" onClick={onClose}>
                                Back to Crafting
                            </Button>
                        </div>
                    ) : (
                        <div className="placeholder-panel">Loading craft detail…</div>
                    )}
                </div>
            </div>
        );
    }

    const steps = filterSteps(view.steps, filter);
    const showMachines = !view.finished && view.consumed !== null;

    return (
        <div className="page craft">
            <div className="page__main">
                {header}
                <section className="craft__head">
                    <ItemIcon itemid={view.outputItemid} name={view.outputName} size={40} />
                    <div className="craft__title-block">
                        <span className="craft__title">
                            <FormattedText text={view.outputName} />{" "}
                            <span className="craft__qty">×{view.outputQty.toLocaleString("en-US")}</span>
                        </span>
                        <span className="craft__subtitle">
                            {selected === "all" && live?.gridLabel
                                ? `${view.subtitle} · network ${live.gridLabel}`
                                : view.subtitle}
                        </span>
                    </div>
                    <Badge variant={view.statusVariant} size="md">
                        {view.statusLabel}
                    </Badge>
                    {view.finished ? (
                        <Button
                            variant="primary"
                            onClick={() =>
                                startOrder({
                                    sourceGridKey: gridKey,
                                    itemid: view.outputItemid,
                                    itemname: view.outputName,
                                    quantity: view.outputQty,
                                })
                            }
                        >
                            Craft again
                        </Button>
                    ) : (
                        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                            Cancel job
                        </Button>
                    )}
                </section>

                <section className="craft__summary">
                    {view.progress && (
                        <div className="craft__progress">
                            <SegBar
                                done={view.progress.fraction}
                                active={view.progress.activeFraction}
                                color={view.finished ? "var(--green)" : "var(--amber)"}
                            />
                            <span className="craft__caption">{view.progress.caption}</span>
                        </div>
                    )}
                    {!view.finished && <Throughput samples={samples} />}
                    {view.stats.map((st) => (
                        <div className="craft__stat" key={st.label}>
                            <span className="section-label">{st.label}</span>
                            <span className="craft__stat-value">{st.value}</span>
                        </div>
                    ))}
                </section>

                {view.stall && (
                    <p className="craft__notice">
                        No progress for {view.stall.duration}.{view.stall.reason ? ` ${view.stall.reason}` : ""}
                    </p>
                )}

                <div className="craft__body">
                    <div className="page__scroll craft__main">
                        <div className="craft__toolbar">
                            <input
                                type="search"
                                className="field craft__filter"
                                placeholder="Filter items…"
                                value={filter}
                                onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
                            />
                            <ChipMenu
                                options={[
                                    { value: true, label: "Group by stage" },
                                    { value: false, label: "No grouping" },
                                ]}
                                value={grouped}
                                onChange={setGrouped}
                            />
                            <span className="mono-count craft__count">
                                {steps.length} step{steps.length === 1 ? "" : "s"}
                            </span>
                        </div>
                        <StepTable
                            steps={steps}
                            tracked={view.tracked}
                            groupByStage={grouped}
                            hidden={view.finished || filter.trim() !== "" ? [] : hidden}
                            onToggleStage={(stage) =>
                                setHidden((h) => (h.includes(stage) ? h.filter((k) => k !== stage) : [...h, stage]))
                            }
                            sort={sort}
                            onSort={(key) =>
                                setSort((cur) =>
                                    cur.key === key ? { key, desc: !cur.desc } : { key, desc: key !== "name" },
                                )
                            }
                            onOpenItem={setOpenItem}
                        />
                        {view.consumed !== null && (
                            <div className="craft__consumed">
                                <ConsumedSection rows={view.consumed} onOpenItem={setOpenItem} />
                            </div>
                        )}
                    </div>
                    {showMachines && (
                        <aside className="craft__machines">
                            <WorkingMachines rows={view.machines} gt={workingGT} />
                        </aside>
                    )}
                </div>
            </div>

            {openItem && <JobItemDetail gridKey={gridKey} item={openItem} onClose={() => setOpenItem(null)} />}

            {confirmOpen && (
                <Modal
                    onClose={() => setConfirmOpen(false)}
                    width={420}
                    title="Cancel job?"
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={cancelling}>
                                Keep crafting
                            </Button>
                            <Button variant="danger" onClick={() => void onConfirmCancel()} disabled={cancelling}>
                                {cancelling ? "Cancelling…" : "Cancel job"}
                            </Button>
                        </>
                    }
                >
                    <p>
                        This discards the in-progress job for {skipSpecialFormat(view.outputName)} on {cpuName}. This
                        can&apos;t be undone.
                    </p>
                </Modal>
            )}
        </div>
    );
}

/** The CPU tab strip across the top: every CPU of the selection, the open one highlighted. */
function CpuTabs({
    gridKey,
    cpuKey,
    onBack,
    onOpen,
}: {
    gridKey: GridKey;
    cpuKey: string;
    onBack: () => void;
    onOpen: (cpu: CpuView) => void;
}) {
    const { cpus } = useCpus();
    const ordered = [...cpus].sort((a, b) => cpuRank(a) - cpuRank(b));
    return (
        <nav className="cpu-tabs" aria-label="CPUs">
            <button type="button" className="cpu-tabs__back" onClick={onBack}>
                ← CRAFTING
            </button>
            {ordered.map((cpu) => {
                const current = cpu.sourceGridKey === gridKey && cpu.cpuKey === cpuKey;
                const stalled = cpu.isBusy && cpu.stalledSince > 0;
                return (
                    <button
                        key={`${cpu.sourceGridKey}:${cpu.cpuKey}`}
                        type="button"
                        className={cx("cpu-tabs__tab", current && "cpu-tabs__tab--current")}
                        aria-current={current ? "page" : undefined}
                        disabled={!cpu.isBusy && !current}
                        title={cpu.isBusy ? undefined : `${cpu.name} is idle`}
                        onClick={() => !current && onOpen(cpu)}
                    >
                        <span className="led led--sm" style={{ background: cpuLedColor(cpu) }} />
                        <span className="cpu-tabs__name">{cpu.name}</span>
                        {cpu.isBusy && cpu.finalOutput && (
                            <ItemIcon
                                itemid={cpu.finalOutput.itemid}
                                name={cpu.finalOutput.itemname}
                                size={18}
                                className="cpu-tabs__icon"
                            />
                        )}
                        <span className={cx("cpu-tabs__pct", stalled && "red")}>
                            {!cpu.isBusy
                                ? "idle"
                                : stalled
                                  ? "stalled"
                                  : cpu.progressPct !== null
                                    ? `${cpu.progressPct}%`
                                    : ""}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}

/** Units crafted per minute since this page opened, as a sparkline; hidden until two minutes compare. */
function Throughput({ samples }: { samples: ProgressSample[] }) {
    const perMinute = craftedPerMinute(samples);
    if (perMinute.length < 2) return null;
    const max = Math.max(1, ...perMinute);
    const points = perMinute
        .map((v, i) => `${((i / (perMinute.length - 1)) * 200).toFixed(1)},${(29 - (v / max) * 27).toFixed(1)}`)
        .join(" ");
    return (
        <div
            className="craft__throughput"
            title={`Last minute: ${perMinute[perMinute.length - 1]!.toFixed(0)} crafted`}
        >
            <span className="section-label">Crafted / min · since opened</span>
            <svg width="200" height="30" viewBox="0 0 200 30" aria-label="Crafted per minute since this page opened">
                <line x1="0" y1="29.5" x2="200" y2="29.5" stroke="var(--border)" />
                <polyline points={points} fill="none" stroke="var(--amber)" stroke-width="1.5" />
            </svg>
        </div>
    );
}

/** The steps whose plain name or itemid contains `filter`, case-insensitive. */
function filterSteps(steps: CraftStepRow[], filter: string): CraftStepRow[] {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return steps;
    return steps.filter(
        (r) => skipSpecialFormat(r.itemname).toLowerCase().includes(needle) || r.itemid.toLowerCase().includes(needle),
    );
}
