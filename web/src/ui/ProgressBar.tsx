import { useRef } from "preact/hooks";

import { cx } from "./cx";
import { useCycleAnimation } from "./useCycleAnimation";
import type { FillCycle } from "./useCycleAnimation";

export interface ProgressBarProps {
    /** 0-100; clamped so a bad progress approximation (see REDESIGN_MILESTONES.md risks) never overshoots. */
    percent: number;
    /** Fills continuously, 0 to 100% once per cycle (a running recipe), instead of sitting at `percent`. */
    cycle?: FillCycle | null;
    height?: number;
    color?: string;
    animated?: boolean;
    className?: string;
}

export function ProgressBar({
    percent,
    cycle,
    height = 6,
    color = "var(--accent)",
    animated = true,
    className,
}: ProgressBarProps) {
    const fill = useRef<HTMLDivElement>(null);
    useCycleAnimation(fill, cycle);
    const clamped = Math.min(100, Math.max(0, percent));
    return (
        <div className={cx("progress-track", className)} style={{ height: `${height}px` }}>
            <div
                ref={fill}
                className={cx("progress-fill", cycle && "progress-fill--cycle")}
                style={{
                    width: cycle ? undefined : `${clamped}%`,
                    background: color,
                    transition: animated && !cycle ? undefined : "none",
                }}
            />
        </div>
    );
}
