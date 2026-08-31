import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap + Escape-to-close for modals and drawers. The design prototype has neither (see
 * claude-design/README.md's Interactions note that both should be added in production).
 *
 * `enabled` (default true) lets a caller suspend the trap - e.g. a Drawer hosting a confirm Modal on
 * top of it passes `false` while that Modal owns focus, so nothing here fights over the initial focus
 * or the Tab cycle.
 */
export function useDialogA11y<T extends HTMLElement>(onClose: () => void, enabled = true) {
    const ref = useRef<T>(null);

    useEffect(() => {
        if (!enabled) return;
        const container = ref.current;
        if (!container) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;

        const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
        (focusables()[0] ?? container).focus();

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== "Tab") return;
            const items = focusables();
            if (items.length === 0) return;
            const firstEl = items[0]!;
            const lastEl = items[items.length - 1]!;
            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        }

        container.addEventListener("keydown", onKeyDown);
        return () => {
            container.removeEventListener("keydown", onKeyDown);
            previouslyFocused?.focus();
        };
    }, [onClose, enabled]);

    return ref;
}
