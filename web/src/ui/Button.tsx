import type { ComponentChildren, JSX } from "preact";

import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill" | "icon" | "text";

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "className"> {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    className?: string;
    children?: ComponentChildren;
}

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonProps) {
    const sizeClass = variant === "pill" || variant === "icon" || variant === "text" ? null : `btn--${size}`;
    return (
        <button className={cx("btn", `btn--${variant}`, sizeClass, className)} {...rest}>
            {children}
        </button>
    );
}
