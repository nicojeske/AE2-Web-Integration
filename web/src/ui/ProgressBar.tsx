import { cx } from "./cx";

export interface ProgressBarProps {
    /** 0-100; clamped so a bad progress approximation (see REDESIGN_MILESTONES.md risks) never overshoots. */
    percent: number;
    height?: number;
    color?: string;
    animated?: boolean;
    className?: string;
}

export function ProgressBar({
    percent,
    height = 6,
    color = "var(--accent)",
    animated = true,
    className,
}: ProgressBarProps) {
    const clamped = Math.min(100, Math.max(0, percent));
    return (
        <div className={cx("progress-track", className)} style={{ height: `${height}px` }}>
            <div
                className="progress-fill"
                style={{
                    width: `${clamped}%`,
                    background: color,
                    transition: animated ? undefined : "none",
                }}
            />
        </div>
    );
}
