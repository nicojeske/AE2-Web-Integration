import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap + Escape-to-close for modals and drawers. The design prototype has neither (see
 * claude-design/README.md's Interactions note that both should be added in production).
 */
export function useDialogA11y<T extends HTMLElement>(onClose: () => void) {
    const ref = useRef<T>(null);

    useEffect(() => {
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
    }, [onClose]);

    return ref;
}
