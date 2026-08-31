import type { ComponentChildren } from "preact";

import { cx } from "./cx";

export interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    children?: ComponentChildren;
    className?: string;
}

/** The design's 16px square toggle (notify checkbox, auto-craft, manage-tracked rows) - not a native input. */
export function Checkbox({ checked, onChange, children, className }: CheckboxProps) {
    return (
        <section
            className={cx("checkbox-row", className)}
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => onChange(!checked)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(!checked);
                }
            }}
        >
            <span className={cx("checkbox-box", checked && "checkbox-box--checked")} />
            {children}
        </section>
    );
}
