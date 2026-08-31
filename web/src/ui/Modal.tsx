import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";

import { useDialogA11y } from "./useDialogA11y";

export interface ModalProps {
    onClose: () => void;
    width?: number;
    /** Plain-text title bar with a default close button. Ignored if `header` is given. */
    title?: string;
    /** Full custom header row (e.g. an item icon + name) - must include its own close control. */
    header?: ComponentChildren;
    children?: ComponentChildren;
    footer?: ComponentChildren;
    backdrop?: string;
}

export function Modal({
    onClose,
    width = 480,
    title,
    header,
    children,
    footer,
    backdrop = "var(--backdrop-order)",
}: ModalProps) {
    const ref = useDialogA11y<HTMLDivElement>(onClose);
    const onBackdropClick: JSX.MouseEventHandler<HTMLDivElement> = (e) => {
        if (e.target === e.currentTarget) onClose();
    };

    return createPortal(
        <div className="modal-backdrop" style={{ background: backdrop }} onClick={onBackdropClick}>
            <div
                ref={ref}
                className="modal"
                style={{ width: `${width}px`, maxWidth: "92vw" }}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
            >
                <div className="modal__header">
                    {header ?? (
                        <>
                            <h2 className="modal__title">{title}</h2>
                            <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                                ×
                            </button>
                        </>
                    )}
                </div>
                <div className="modal__body">{children}</div>
                {footer && <div className="modal__footer">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}
