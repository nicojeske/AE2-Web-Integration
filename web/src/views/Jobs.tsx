import { useEffect, useState } from "preact/hooks";

import { formatBytes, formatDuration, formatNumber } from "../api/format";
import { estimateRemaining } from "../state/craftProgress";
import { useCpus } from "../state/cpus";
import { useNetwork } from "../state/network";
import { usePrefs } from "../state/prefs";
import { Button } from "../ui/Button";
import { cpuLedColor, cpuRank } from "../ui/CpuLeds";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import type { CpuView } from "../state/cpus";

export interface JobsProps {
    /** Busy cards route to the full Craft Detail page - owned by `App.tsx`'s `Shell`, which is also the
     *  sole writer of `useCpus().detailScope` (narrowed to just that CPU once it's open). */
    onOpenCraftDetail: (cpu: CpuView) => void;
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

    const usedBytes = cpus.reduce((sum, c) => sum + (c.isBusy && c.usedStorage > 0 ? c.usedStorage : 0), 0);
    const totalBytes = cpus.reduce((sum, c) => sum + c.availableStorage, 0);
    const groups: { label: string; color: string; cpus: CpuView[] }[] = [
        { label: "Needs attention", color: "var(--red)", cpus: cpus.filter((c) => cpuRank(c) === 0) },
        { label: "Running", color: "var(--text-dim)", cpus: cpus.filter((c) => cpuRank(c) === 1) },
        { label: "Idle", color: "var(--text-dim)", cpus: cpus.filter((c) => cpuRank(c) === 2) },
    ];

    return (
        <div className="page">
            <div className="page__main">
                <header className="page-header">
                    <h2 className="page-header__title">Crafting CPUs</h2>
                    <span className="page-header__sub">
                        {cpus.filter((c) => c.isBusy).length} busy · {cpus.filter((c) => !c.isBusy).length} idle
                    </span>
                    <span className="page-header__end mono-count">
                        {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
                    </span>
                </header>
                {isAllGrids && failedGrids.length > 0 && (
                    <p className="browser__warning">{`Couldn't load jobs from: ${failedGrids.join(", ")}`}</p>
                )}
                <div className="page__scroll">
                    {cpus.length === 0 ? (
                        <div className="placeholder-panel">No crafting CPUs on this network.</div>
                    ) : (
                        groups
                            .filter((g) => g.cpus.length > 0)
                            .map((group) => (
                                <section key={group.label} className="cpu-list__group">
                                    <div className="dtable__group" style={{ color: group.color }}>
                                        {group.label}
                                        <span className="mono-count">{group.cpus.length}</span>
                                    </div>
                                    {group.cpus.map((cpu) => (
                                        <CpuRow
                                            key={`${cpu.sourceGridKey}:${cpu.cpuKey}`}
                                            cpu={cpu}
                                            timing={cardTiming(cpu, now)}
                                            showGrid={isAllGrids}
                                            numberFormat={settings.numberFormat}
                                            onOpen={() => onOpenCraftDetail(cpu)}
                                        />
                                    ))}
                                </section>
                            ))
                    )}
                </div>
            </div>
        </div>
    );
}

function CpuRow({
    cpu,
    timing,
    showGrid,
    numberFormat,
    onOpen,
}: {
    cpu: CpuView;
    timing: CardTiming | null;
    showGrid: boolean;
    numberFormat: "full" | "compact";
    onOpen: () => void;
}) {
    const stalled = cpu.isBusy && cpu.stalledSince > 0;
    const color = cpuLedColor(cpu);
    const storage = `${cpu.usedStorage === -1 ? "—" : formatBytes(cpu.usedStorage)} / ${formatBytes(cpu.availableStorage)}`;
    const Tag = cpu.isBusy ? "button" : "div";
    return (
        <Tag
            type={cpu.isBusy ? "button" : undefined}
            className={cx("cpu-row", cpu.isBusy && "cpu-row--busy")}
            onClick={cpu.isBusy ? onOpen : undefined}
        >
            <div className="cpu-row__line">
                <span className="led" style={{ background: color }} />
                <span className="cpu-row__name">{cpu.name}</span>
                {showGrid && <span className="cpu-row__grid">{cpu.gridLabel}</span>}
                <span className={cx("cpu-row__output", !cpu.isBusy && "cpu-row__output--idle")}>
                    {cpu.isBusy && cpu.finalOutput ? (
                        <>
                            <FormattedText text={cpu.finalOutput.itemname} /> ×
                            {formatNumber(cpu.finalOutput.quantity, numberFormat)}
                        </>
                    ) : cpu.isBusy ? (
                        "Crafting"
                    ) : (
                        "Idle"
                    )}
                </span>
                <span className={cx("cpu-row__pct", stalled && "red")}>
                    {cpu.isBusy && cpu.progressPct !== null ? `${cpu.progressPct}%` : ""}
                </span>
                <span className="cpu-row__meta">
                    {cpu.coProcessors} co-proc{cpu.coProcessors === 1 ? "" : "s"} · {storage}
                </span>
            </div>
            {cpu.isBusy && (
                <>
                    <div className="cpu-row__bar">
                        <div style={{ width: `${cpu.progressPct ?? 0}%`, background: color }} />
                    </div>
                    <div className={cx("cpu-row__sub", stalled && "red")}>
                        <span>
                            {timing?.stalledFor
                                ? `No progress for ${timing.stalledFor}`
                                : timing
                                  ? `${timing.elapsed}${timing.remaining ? ` · ~${timing.remaining} left` : ""}`
                                  : "Untracked"}
                        </span>
                        {cpu.requestedBy && <span className="cpu-row__by">by {cpu.requestedBy}</span>}
                    </div>
                </>
            )}
        </Tag>
    );
}
