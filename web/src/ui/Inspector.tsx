import type { ComponentChildren } from "preact";

import { Drawer } from "./Drawer";
import { INLINE_INSPECTOR_QUERY, useMediaQuery } from "./useMediaQuery";

export interface InspectorProps {
    /** Accessible name, and the slide-over's title when it isn't inline. */
    label: string;
    width?: number;
    /** Whether there's something to inspect. Inline, `placeholder` shows otherwise; as a slide-over, nothing does. */
    open: boolean;
    onClose: () => void;
    placeholder?: ComponentChildren;
    /** Always a slide-over, even on wide screens (Craft Detail's item panel opens over its machines aside). */
    overlayOnly?: boolean;
    children?: ComponentChildren;
}

/**
 * A page's right-hand detail pane: an inline aside from 1280px, where list and detail fit side by side,
 * and a slide-over (Drawer, with its focus trap and Escape) below that.
 */
export function Inspector({ label, width = 400, open, onClose, placeholder, overlayOnly, children }: InspectorProps) {
    const wide = useMediaQuery(INLINE_INSPECTOR_QUERY);
    if (wide && !overlayOnly) {
        if (!open && placeholder === undefined) return null;
        return (
            <aside className="inspector" style={{ width: `${width}px` }} aria-label={label}>
                {open ? children : <div className="inspector__empty">{placeholder}</div>}
            </aside>
        );
    }
    if (!open) return null;
    return (
        <Drawer title={label} onClose={onClose} width={width + 40} className="inspector-overlay">
            {children}
        </Drawer>
    );
}
