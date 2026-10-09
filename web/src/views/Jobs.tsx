import { useEffect, useState } from "preact/hooks";

import { formatBytes, formatDuration, formatNumber } from "../api/format";
import { estimateRemaining } from "../state/craftProgress";
import { useCpus } from "../state/cpus";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { ProgressBar } from "../ui/ProgressBar";
import type { CpuView } from "../state/cpus";

export interface JobsProps {
    /** Busy cards route to the full Craft Detail page - owned by `App.tsx`'s `Shell`, which is also the
     *  sole writer of `useCpus().detailScope` (narrowed to just that CPU once it's open). */
    onOpenCraftDetail: (cpu: CpuView) => void;
}

/** Stalled first (they need attention), then the rest of the busy CPUs, then idle ones. */
function cardRank(cpu: CpuView): number {
    if (!cpu.isBusy) return 2;
    return cpu.stalledSince > 0 ? 0 : 1;
}

interface CardTiming {
    elapsed: string;
    remaining: string | null;
    stalledFor: string | null;
}

/** A tracked job's live timings: the list's server-measured elapsed, ticked on since it was fetched. */
function cardTiming(cpu: CpuView, now: number): CardTiming | null {
    if (!cpu.isBusy || !cpu.hasTrackingInfo) return null;
    const elapsed = cpu.timeElapsed + Math.max(0, now - cpu.listFetchedAt);
    const remaining =
        cpu.progressPct !== null && cpu.stalledSince === 0 ? estimateRemaining(elapsed, cpu.progressPct / 100) : null;
    // `stalledSince` is on the server's clock, like `timeStarted + elapsed`.
    const stalledFor = cpu.stalledSince > 0 ? cpu.timeStarted + elapsed - cpu.stalledSince : null;
    return {
        elapsed: formatDuration(elapsed),
        remaining: remaining !== null ? formatDuration(remaining) : null,
        stalledFor: stalledFor !== null ? formatDuration(Math.max(0, stalledFor)) : null,
    };
}

export function Jobs({ onOpenCraftDetail }: JobsProps) {
    const { cpus, loading, error, failedGrids, refresh } = useCpus();
    const { selected, selectedGrid } = useNetwork();
    const { settings } = usePrefs();
    const [now, setNow] = useState(Date.now());

    // Ticks elapsed/ETA/stalled-for between polls, paused with the poller while the tab is hidden.
    useEffect(() => {
        const id = setInterval(() => {
            if (!document.hidden) setNow(Date.now());
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const isAllGrids = selected === "all";

    if (selected !== "all" && !selectedGrid) {
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

    const ordered = [...cpus].sort((a, b) => cardRank(a) - cardRank(b));
    const busy = cpus.filter((c) => c.isBusy).length;
    const stalled = cpus.filter((c) => c.isBusy && c.stalledSince > 0).length;
    const usedBytes = cpus.reduce((sum, c) => sum + (c.isBusy && c.usedStorage > 0 ? c.usedStorage : 0), 0);
    const totalBytes = cpus.reduce((sum, c) => sum + c.availableStorage, 0);

    return (
        <>
            {isAllGrids && failedGrids.length > 0 && (
                <p className="browser__warning">{`Couldn't load jobs from: ${failedGrids.join(", ")}`}</p>
            )}

            {cpus.length > 0 && (
                <section className="jobs-summary">
                    <span>
                        <strong>{busy}</strong> busy
                    </span>
                    <span>
                        <strong>{cpus.length - busy}</strong> idle
                    </span>
                    {stalled > 0 && (
                        <span className="jobs-summary__stalled">
                            <strong>{stalled}</strong> stalled
                        </span>
                    )}
                    <span className="jobs-summary__bytes">
                        {formatBytes(usedBytes)} of {formatBytes(totalBytes)} in use
                    </span>
                </section>
            )}

            {cpus.length === 0 ? (
                <div className="placeholder-panel">No crafting CPUs on this network.</div>
            ) : (
                <section className="cpu-grid">
                    {ordered.map((cpu) => {
                        const timing = cardTiming(cpu, now);
                        const isStalled = cpu.isBusy && cpu.stalledSince > 0;
                        return (
                            <Card
                                key={`${cpu.sourceGridKey}:${cpu.cpuKey}`}
                                clickable={cpu.isBusy}
                                className={`cpu-card${isStalled ? " cpu-card--stalled" : ""}`}
                                onClick={cpu.isBusy ? () => onOpenCraftDetail(cpu) : undefined}
                            >
                                <div className="cpu-card__head">
                                    <div className="cpu-card__title">
                                        <span className="cpu-card__name">{cpu.name}</span>
                                        {isAllGrids && <span className="cpu-card__grid-label">{cpu.gridLabel}</span>}
                                    </div>
                                    <Badge variant={isStalled ? "red" : cpu.isBusy ? "amber" : "grey"} size="sm">
                                        {isStalled ? "Stalled" : cpu.isBusy ? "Busy" : "Idle"}
                                    </Badge>
                                </div>
                                {cpu.isBusy && cpu.finalOutput ? (
                                    <div className="cpu-card__output-row">
                                        <ItemIcon
                                            itemid={cpu.finalOutput.itemid}
                                            name={cpu.finalOutput.itemname}
                                            size={24}
                                        />
                                        <span className="cpu-card__output">
                                            Crafting <FormattedText text={cpu.finalOutput.itemname} /> x
                                            {formatNumber(cpu.finalOutput.quantity, settings.numberFormat)}
                                        </span>
                                    </div>
                                ) : (
                                    <span className="cpu-card__output">No active job</span>
                                )}
                                {cpu.isBusy && cpu.progressPct !== null && (
                                    <ProgressBar percent={cpu.progressPct} height={6} />
                                )}
                                {timing && (
                                    <div className="cpu-card__timing">
                                        {timing.stalledFor !== null ? (
                                            <span className="cpu-card__stalled">
                                                No progress for {timing.stalledFor}
                                            </span>
                                        ) : (
                                            <span>
                                                {timing.elapsed}
                                                {timing.remaining !== null && ` · ~${timing.remaining} left`}
                                            </span>
                                        )}
                                        {cpu.requestedBy && <span>by {cpu.requestedBy}</span>}
                                    </div>
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
                        );
                    })}
                </section>
            )}
        </>
    );
}
