import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, cancelCpu } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import type { GridKey } from "../api/types";
import { useCpus } from "../state/cpus";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import { useToast } from "../state/toast";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { Modal } from "../ui/Modal";
import { ProgressBar } from "../ui/ProgressBar";
import { ItemIcon } from "../ui/ItemIcon";
import { ConsumedSection, CraftDetailColumns, CraftDetailHeader, StatCard, WorkingMachines } from "./craftDetailParts";
import { buildActiveCraftDetail, isJobFinished, snapshotOf } from "./craftDetailModel";
import type { CraftDetailColumn, CraftDetailColumnKey, CraftDetailSnapshot } from "./craftDetailModel";

export interface CraftDetailProps {
    gridKey: GridKey;
    cpuKey: string;
    onClose: () => void;
}

export function CraftDetail({ gridKey, cpuKey, onClose }: CraftDetailProps) {
    const { cpus, suppressCompletion, refresh } = useCpus();
    const { selected } = useNetwork();
    const toast = useToast();
    const { startOrder } = useOrder();

    const [now, setNow] = useState(Date.now());
    const [bottleneckOpen, setBottleneckOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [filter, setFilter] = useState("");
    // Done grows all job long and is the least interesting column while it runs.
    const [collapsed, setCollapsed] = useState<CraftDetailColumnKey[]>(["done"]);

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

    const view = buildActiveCraftDetail(live, snapshotRef.current, now);
    const cpuName = live?.name ?? snapshotRef.current?.cpuName ?? "this CPU";
    const finished = isJobFinished(live);

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

    if (!view) {
        if (finished) {
            // No snapshot was ever captured (e.g. the job finished between the card click and the
            // first `/get`). Unlike the prototype, which strands the user with no buttons at all here,
            // this keeps a way back to Jobs.
            return (
                <section className="craft-detail">
                    <CraftDetailHeader
                        outputName="Job finished"
                        outputQty={null}
                        subtitle="This CPU is idle again"
                        statusLabel="Idle"
                        statusVariant="grey"
                        onClose={onClose}
                    />
                    <div className="craft-detail__actions">
                        <Button variant="secondary" onClick={onClose}>
                            Back to jobs
                        </Button>
                    </div>
                </section>
            );
        }
        return <div className="placeholder-panel">Loading craft detail…</div>;
    }

    return (
        <section className="craft-detail">
            <CraftDetailHeader
                outputItemid={view.outputItemid}
                outputName={view.outputName}
                outputQty={view.outputQty}
                subtitle={
                    selected === "all" && live?.gridLabel
                        ? `${view.subtitle} - network ${live.gridLabel}`
                        : view.subtitle
                }
                statusLabel={view.statusLabel}
                statusVariant={view.statusVariant}
                onClose={onClose}
            />

            <section className="craft-detail__stats">
                <StatCard label="Output">
                    <FormattedText text={view.outputName} /> x{view.outputQty.toLocaleString("en-US")}
                </StatCard>
                {view.stats.map((st) => (
                    <StatCard key={st.label} label={st.label}>
                        {st.value}
                    </StatCard>
                ))}
            </section>

            {view.stall && (
                <p className="craft-detail__notice craft-detail__notice--error">
                    No progress for {view.stall.duration}.{view.stall.reason ? ` ${view.stall.reason}` : ""}
                </p>
            )}

            {view.progress && (
                <section className="craft-detail__progress">
                    <ProgressBar percent={view.progress.fraction * 100} height={8} />
                    <span className="craft-detail__progress-caption">{view.progress.caption}</span>
                </section>
            )}

            {!view.finished && view.consumed !== null && <WorkingMachines rows={view.machines} />}

            <section className="plan-toolbar">
                <input
                    type="search"
                    className="plan-toolbar__search"
                    placeholder="Filter items…"
                    value={filter}
                    onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
                />
            </section>

            <CraftDetailColumns
                columns={filterColumns(view.columns, filter)}
                collapsed={view.finished || filter.trim() !== "" ? [] : collapsed}
                onToggleCollapsed={
                    view.finished
                        ? undefined
                        : (key) => setCollapsed((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]))
                }
            />

            {view.consumed !== null && <ConsumedSection rows={view.consumed} />}

            {view.bottleneck && view.bottleneck.length > 0 && (
                <section className="craft-detail__bottleneck">
                    <button
                        type="button"
                        className="craft-detail__bottleneck-head"
                        onClick={() => setBottleneckOpen((v) => !v)}
                    >
                        <span className="craft-detail__bottleneck-title">Where the time went</span>
                        <span className="craft-detail__bottleneck-hint">Top 5 by time spent</span>
                        <span className="craft-detail__bottleneck-caret">{bottleneckOpen ? "–" : "+"}</span>
                    </button>
                    {bottleneckOpen && (
                        <div className="craft-detail__bottleneck-body">
                            {view.bottleneck.map((row) => (
                                <div className="craft-detail__bottleneck-row" key={row.itemid}>
                                    <ItemIcon itemid={row.itemid} name={row.itemname} size={20} />
                                    <FormattedText text={row.itemname} className="craft-detail__bottleneck-name" />
                                    <div className="craft-detail__bottleneck-track">
                                        <div
                                            className="craft-detail__bottleneck-fill"
                                            style={{ width: `${Math.round(row.sharePct * 100)}%` }}
                                        />
                                    </div>
                                    <span className="craft-detail__bottleneck-value">{row.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <section className="craft-detail__actions">
                {view.finished ? (
                    <>
                        <Button variant="secondary" onClick={onClose}>
                            Back to jobs
                        </Button>
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
                    </>
                ) : (
                    <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                        Cancel job
                    </Button>
                )}
            </section>

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
                                {cancelling ? "Cancelling…" : "Cancel Job"}
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
        </section>
    );
}

/** Narrows every column to the rows whose plain name or itemid contains `filter`, case-insensitive. */
function filterColumns(columns: CraftDetailColumn[], filter: string): CraftDetailColumn[] {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return columns;
    return columns.map((col) => ({
        ...col,
        rows: col.rows.filter(
            (r) =>
                skipSpecialFormat(r.itemname).toLowerCase().includes(needle) || r.itemid.toLowerCase().includes(needle),
        ),
    }));
}
