import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";

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
}

export function Drawer({ title, subtitle, onClose, children, footer, trapFocus = true }: DrawerProps) {
    const ref = useDialogA11y<HTMLDivElement>(onClose, trapFocus);
    const onBackdropClick: JSX.MouseEventHandler<HTMLDivElement> = (e) => {
        if (e.target === e.currentTarget) onClose();
    };

    return createPortal(
        <div className="drawer-backdrop" style={{ background: "var(--backdrop-drawer)" }} onClick={onBackdropClick}>
            <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
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
