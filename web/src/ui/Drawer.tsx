import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";

import { cx } from "./cx";
import { useDialogA11y } from "./useDialogA11y";

export interface DrawerProps {
    title: string;
    subtitle?: string;
    onClose: () => void;
    children?: ComponentChildren;
    footer?: ComponentChildren;
    /** Suspends the focus trap/Escape handling - set false while a dialog nested on top (e.g. a
     * confirm Modal) should own focus instead. Defaults to true. */
    trapFocus?: boolean;
    /** `"bottom"` is the phone's "More" sheet; everything else is a right-hand slide-over. */
    side?: "left" | "right" | "bottom";
    width?: number;
    className?: string;
}

export function Drawer({
    title,
    subtitle,
    onClose,
    children,
    footer,
    trapFocus = true,
    side = "right",
    width,
    className,
}: DrawerProps) {
    const ref = useDialogA11y<HTMLDivElement>(onClose, trapFocus);
    const onBackdropClick: JSX.MouseEventHandler<HTMLDivElement> = (e) => {
        if (e.target === e.currentTarget) onClose();
    };

    return createPortal(
        <div
            className={cx("drawer-backdrop", side !== "right" && `drawer-backdrop--${side}`)}
            style={{ background: "var(--backdrop-drawer)" }}
            onClick={onBackdropClick}
        >
            <div
                ref={ref}
                className={cx("drawer", side !== "right" && `drawer--${side}`, className)}
                style={width !== undefined && side === "right" ? { width: `${width}px` } : undefined}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
            >
                <div className="drawer__header">
                    <div>
                        <h2 className="drawer__title">{title}</h2>
                        {subtitle && <div className="drawer__subtitle">{subtitle}</div>}
                    </div>
                    <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
                <div className="drawer__body">{children}</div>
                {footer && <div className="drawer__footer">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}
