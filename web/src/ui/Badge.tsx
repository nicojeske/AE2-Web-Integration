import type { ComponentChildren } from "preact";

import { cx } from "./cx";

export type BadgeVariant = "green" | "amber" | "red" | "grey" | "teal" | "purple";

export interface BadgeProps {
    variant: BadgeVariant;
    size?: "sm" | "md";
    children?: ComponentChildren;
    className?: string;
}

/** The design's "status pill" - used for CPU busy/idle, job status, low stock, craftable, etc. */
export function Badge({ variant, size = "md", children, className }: BadgeProps) {
    return <span className={cx("badge", `badge--${variant}`, `badge--${size}`, className)}>{children}</span>;
}
