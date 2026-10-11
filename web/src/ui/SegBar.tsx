export interface SegBarProps {
    /** `0..1` done. */
    done: number;
    /** `0..1` in progress, drawn after `done` at reduced opacity. */
    active?: number;
    segments?: number;
    color?: string;
    height?: number;
}

/** The job progress strip: `segments` equal cells, lit for done, half-lit for in-progress. */
export function SegBar({ done, active = 0, segments = 60, color = "var(--amber)", height = 10 }: SegBarProps) {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const lit = Math.round(clamp(done) * segments);
    const half = Math.min(segments - lit, Math.round(clamp(active) * segments));
    return (
        <div
            className="segbar"
            style={{ gridTemplateColumns: `repeat(${segments}, 1fr)`, height: `${height}px` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamp(done) * 100)}
        >
            {Array.from({ length: segments }, (_, i) => (
                <span
                    key={i}
                    style={{
                        background: i < lit + half ? color : "var(--border-subtle)",
                        opacity: i >= lit && i < lit + half ? 0.35 : undefined,
                    }}
                />
            ))}
        </div>
    );
}
