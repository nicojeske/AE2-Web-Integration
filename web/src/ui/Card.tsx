import type { ComponentChildren, JSX } from "preact";

import { cx } from "./cx";

export interface CardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "className"> {
    children?: ComponentChildren;
    clickable?: boolean;
    className?: string;
}

export function Card({ children, className, clickable, ...rest }: CardProps) {
    return (
        <div className={cx("card", clickable && "card--clickable", className)} {...rest}>
            {children}
        </div>
    );
}
