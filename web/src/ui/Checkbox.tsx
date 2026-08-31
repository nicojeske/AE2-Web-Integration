import type { ComponentChildren } from "preact";

import { cx } from "./cx";

export interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    children?: ComponentChildren;
    className?: string;
    /** M8: disables an untracked row once the grid's tracked-item cap is reached. */
    disabled?: boolean;
    title?: string;
}

/** The design's 16px square toggle (notify checkbox, auto-craft, manage-tracked rows) - not a native input. */
export function Checkbox({ checked, onChange, children, className, disabled = false, title }: CheckboxProps) {
    return (
        <section
            className={cx("checkbox-row", disabled && "checkbox-row--disabled", className)}
            role="checkbox"
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            title={title}
            onClick={() => !disabled && onChange(!checked)}
            onKeyDown={(e) => {
                if (disabled) return;
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
