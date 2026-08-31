import { useEffect, useState } from "preact/hooks";

import { ApiError, cancelCpu } from "../api/client";
import { formatBytes, formatDuration, formatNumber, skipSpecialFormat } from "../api/format";
import { cpuKey, useCpus } from "../state/cpus";
import { useNetwork } from "../state/network";
import { useToast } from "../state/toast";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { FormattedText } from "../ui/FormattedText";
import { Modal } from "../ui/Modal";
import { ProgressBar } from "../ui/ProgressBar";
import type { CpuView } from "../state/cpus";

export function Jobs() {
    const { cpus, loading, error, failedGrids, setDetailPolling, suppressCompletion, refresh } = useCpus();
    const { selected, selectedGrid } = useNetwork();
    const toast = useToast();

    const [drawerKey, setDrawerKey] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    // Tiered polling: `/list` runs everywhere (drives the sidebar busy pill + completion events), the
    // expensive per-busy-CPU `/get` fan-in only while this view is actually open.
    useEffect(() => {
        setDetailPolling(true);
        return () => setDetailPolling(false);
    }, [setDetailPolling]);

    const isAllGrids = selected === "all";
    const drawerCpu = drawerKey ? (cpus.find((c) => cpuKey(c.sourceGridId, c.name) === drawerKey) ?? null) : null;

    const openDrawer = (cpu: CpuView) => setDrawerKey(cpuKey(cpu.sourceGridId, cpu.name));
    const closeDrawer = () => {
        setDrawerKey(null);
        setConfirmOpen(false);
    };

    const onConfirmCancel = async () => {
        if (!drawerCpu) return;
        setCancelling(true);
        try {
            await cancelCpu(drawerCpu.sourceGridId, drawerCpu.name);
            suppressCompletion(drawerCpu.sourceGridId, drawerCpu.name);
            toast(`Job cancelled on ${drawerCpu.name}`);
            closeDrawer();
            await refresh();
        } catch (e) {
            if (e instanceof ApiError && e.status === "CPU_NOT_BUSY") {
                // Benign race: the job finished between the last poll and the click.
                toast("That job already finished");
                closeDrawer();
                await refresh();
            } else {
                toast(e instanceof ApiError ? e.status : "Failed to cancel job");
            }
        } finally {
            setCancelling(false);
        }
    };

    if (selected !== "all" && (!selectedGrid || selectedGrid.key === -1)) {
        return <div className="placeholder-panel">No network selected.</div>;
    }

    if (loading && cpus.length === 0) {
        return <div className="placeholder-panel">Loading jobs…</div>;
    }

    if (error) {
        return (
            <div className="placeholder-panel browser__error">
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void refresh()}>
                    Retry
                </Button>
            </div>
        );
    }

    let drawerSubtitle = "Idle";
    if (drawerCpu?.isBusy) {
        drawerSubtitle = drawerCpu.finalOutput
            ? `Crafting ${skipSpecialFormat(drawerCpu.finalOutput.itemname)} x${formatNumber(drawerCpu.finalOutput.quantity)}`
            : "Busy";
    }

    const statRows = drawerCpu
        ? [
              {
                  name: "Status",
                  detail: drawerCpu.isBusy
                      ? `Busy - ${formatDuration(drawerCpu.detail?.timeElapsed ?? Date.now() - drawerCpu.timeStarted)} elapsed`
                      : "Idle",
              },
              {
                  name: "Co-processors",
                  detail: `${drawerCpu.coProcessors} co-proc${drawerCpu.coProcessors === 1 ? "" : "s"}`,
              },
              {
                  name: "Storage",
                  detail: `${drawerCpu.usedStorage === -1 ? "—" : formatBytes(drawerCpu.usedStorage)} / ${formatBytes(drawerCpu.availableStorage)}`,
              },
          ]
        : [];
    const itemRows = drawerCpu?.detail?.items ?? [];

    return (
        <>
            {isAllGrids && failedGrids.length > 0 && (
                <p className="browser__warning">{`Couldn't load jobs from: ${failedGrids.join(", ")}`}</p>
            )}

            {cpus.length === 0 ? (
                <div className="placeholder-panel">No crafting CPUs on this network.</div>
            ) : (
                <section className="cpu-grid">
                    {cpus.map((cpu) => (
                        <Card
                            key={`${cpu.sourceGridId}:${cpu.name}`}
                            clickable
                            className="cpu-card"
                            onClick={() => openDrawer(cpu)}
                        >
                            <div className="cpu-card__head">
                                <div className="cpu-card__title">
                                    <span className="cpu-card__name">{cpu.name}</span>
                                    {isAllGrids && <span className="cpu-card__grid-label">{cpu.gridLabel}</span>}
                                </div>
                                <Badge variant={cpu.isBusy ? "amber" : "grey"} size="sm">
                                    {cpu.isBusy ? "Busy" : "Idle"}
                                </Badge>
                            </div>
                            <span className="cpu-card__output">
                                {cpu.isBusy && cpu.finalOutput ? (
                                    <>
                                        Crafting <FormattedText text={cpu.finalOutput.itemname} /> x
                                        {formatNumber(cpu.finalOutput.quantity)}
                                    </>
                                ) : (
                                    "No active job"
                                )}
                            </span>
                            {cpu.isBusy && cpu.progressPct !== null && (
                                <ProgressBar percent={cpu.progressPct} height={6} />
                            )}
                            <div className="cpu-card__footer">
                                <span>
                                    {cpu.coProcessors} co-proc{cpu.coProcessors === 1 ? "" : "s"}
                                </span>
                                <span>
                                    {cpu.usedStorage === -1 ? "—" : formatBytes(cpu.usedStorage)} /{" "}
                                    {formatBytes(cpu.availableStorage)}
                                </span>
                            </div>
                        </Card>
                    ))}
                </section>
            )}

            {drawerCpu && (
                <Drawer
                    title={drawerCpu.name}
                    subtitle={drawerSubtitle}
                    onClose={closeDrawer}
                    trapFocus={!confirmOpen}
                    footer={
                        drawerCpu.isBusy ? (
                            <Button
                                variant="danger"
                                className="cpu-drawer__cancel"
                                onClick={() => setConfirmOpen(true)}
                            >
                                Cancel Job
                            </Button>
                        ) : undefined
                    }
                >
                    {drawerCpu.isBusy && (
                        <Button
                            variant="text"
                            className="cpu-drawer__expand"
                            onClick={() => toast("Craft detail lands in M3")}
                        >
                            View craft detail →
                        </Button>
                    )}
                    {statRows.map((row) => (
                        <div className="drawer-row" key={row.name}>
                            <span className="drawer-row__name">{row.name}</span>
                            <span className="drawer-row__detail">{row.detail}</span>
                        </div>
                    ))}
                    {itemRows.length === 0 ? (
                        <div className="placeholder-panel cpu-drawer__empty">No items on this CPU.</div>
                    ) : (
                        itemRows.map((item) => (
                            <div className="drawer-row" key={item.itemid}>
                                <FormattedText text={item.itemname} className="drawer-row__name" />
                                <span className="drawer-row__detail">
                                    {`Crafting: ${formatNumber(item.active)} - Scheduled: ${formatNumber(item.pending)} - Stored: ${formatNumber(item.stored)}`}
                                </span>
                            </div>
                        ))
                    )}
                </Drawer>
            )}

            {confirmOpen && drawerCpu && (
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
                        This discards the in-progress job
                        {drawerCpu.finalOutput
                            ? ` for ${skipSpecialFormat(drawerCpu.finalOutput.itemname)}`
                            : ""} on {drawerCpu.name}. This can&apos;t be undone.
                    </p>
                </Modal>
            )}
        </>
    );
}
