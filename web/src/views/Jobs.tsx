import { useState } from "preact/hooks";

import { formatBytes, formatNumber } from "../api/format";
import { cpuKey, useCpus } from "../state/cpus";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { FormattedText } from "../ui/FormattedText";
import { ProgressBar } from "../ui/ProgressBar";
import type { CpuView } from "../state/cpus";

export interface JobsProps {
    /** Busy cards route to the full Craft Detail page - owned by `App.tsx`'s `Shell`, which is also the
     *  sole writer of `useCpus().detailScope` (narrowed to just that CPU once it's open). */
    onOpenCraftDetail: (cpu: CpuView) => void;
}

export function Jobs({ onOpenCraftDetail }: JobsProps) {
    const { cpus, loading, error, failedGrids, refresh } = useCpus();
    const { selected, selectedGrid } = useNetwork();
    const { settings } = usePrefs();

    const [drawerKey, setDrawerKey] = useState<string | null>(null);

    const isAllGrids = selected === "all";
    const drawerCpu = drawerKey ? (cpus.find((c) => cpuKey(c.sourceGridId, c.name) === drawerKey) ?? null) : null;

    const onCardClick = (cpu: CpuView) => {
        if (cpu.isBusy) onOpenCraftDetail(cpu);
        else setDrawerKey(cpuKey(cpu.sourceGridId, cpu.name));
    };
    const closeDrawer = () => setDrawerKey(null);

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

    const statRows = drawerCpu
        ? [
              { name: "Status", detail: "Idle" },
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
                            onClick={() => onCardClick(cpu)}
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
                                        {formatNumber(cpu.finalOutput.quantity, settings.numberFormat)}
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

            {/* Only idle CPUs open the drawer now - a busy card routes to Craft Detail, which has its
                own item list and Cancel Job (see REDESIGN_MILESTONES.md M3 deviations). */}
            {drawerCpu && (
                <Drawer title={drawerCpu.name} subtitle="Idle" onClose={closeDrawer}>
                    {statRows.map((row) => (
                        <div className="drawer-row" key={row.name}>
                            <span className="drawer-row__name">{row.name}</span>
                            <span className="drawer-row__detail">{row.detail}</span>
                        </div>
                    ))}
                    <div className="placeholder-panel cpu-drawer__empty">No items on this CPU.</div>
                </Drawer>
            )}
        </>
    );
}
