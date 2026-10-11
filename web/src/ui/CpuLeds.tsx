import type { CpuView } from "../state/cpus";

/** A CPU's LED colour: red while stalled, amber while busy, unlit while idle. */
export function cpuLedColor(cpu: CpuView): string {
    if (!cpu.isBusy) return "var(--led-off)";
    return cpu.stalledSince > 0 ? "var(--red)" : "var(--amber)";
}

/** Stalled first, then busy, then idle - the order the LEDs and lists show CPUs in. */
export function cpuRank(cpu: CpuView): number {
    if (!cpu.isBusy) return 2;
    return cpu.stalledSince > 0 ? 0 : 1;
}

/** One LED per CPU. */
export function CpuLeds({ cpus, small }: { cpus: CpuView[]; small?: boolean }) {
    const ordered = [...cpus].sort((a, b) => cpuRank(a) - cpuRank(b));
    return (
        <span className="leds" aria-hidden="true">
            {ordered.map((cpu) => (
                <span
                    key={`${cpu.sourceGridKey}:${cpu.cpuKey}`}
                    className={small ? "led led--sm" : "led"}
                    style={{ background: cpuLedColor(cpu) }}
                />
            ))}
        </span>
    );
}
