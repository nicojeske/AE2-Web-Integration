import { useEffect, useState } from "preact/hooks";

export interface VirtualWindow {
    /** First visible row (overscan included). */
    startRow: number;
    /** One past the last visible row (overscan included). */
    endRow: number;
    /** Padding to add above the rendered rows so the scrollbar/scroll position stay correct. */
    topSpacerPx: number;
    /** Padding to add below the rendered rows, for the same reason. */
    bottomSpacerPx: number;
}

/**
 * Row-based windowing for a long grid/list living inside the shell's one scrollable region (`.content` -
 * see `app-shell.css`). Hand-rolled rather than a library: the shell has exactly one scroll container
 * ever, and a uniform row height (measured once per screen, not per row - see each caller's own
 * `ROW_HEIGHT_PX` constant) is accurate enough given a few rows of overscan; per-row measurement or
 * variable heights are real complexity none of this app's lists actually need.
 *
 * `container` must be the grid/list element itself (the one the caller adds top/bottom padding to) -
 * its nearest `.content` ancestor is resolved as the scrolling element. Takes it as a plain nullable
 * value (state, via a callback ref) rather than a `RefObject` this hook reads on its own - see
 * `useMeasuredColumns`'s own comment for why a plain ref's non-reactivity would otherwise mean this
 * never finds the container once it mounts behind an initial loading state.
 */
export function useVirtualWindow(
    container: HTMLElement | null,
    rowCount: number,
    rowHeightPx: number,
    overscanRows = 3,
): VirtualWindow {
    const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: rowCount });

    useEffect(() => {
        const scrollEl = container?.closest<HTMLElement>(".content") ?? null;
        if (!container || !scrollEl) {
            setRange({ start: 0, end: rowCount });
            return;
        }

        let raf = 0;
        const recompute = () => {
            raf = 0;
            // Re-measured every call rather than cached - content above the grid (a toolbar that can
            // wrap, a warning banner) can change the container's offset at any time, and this is cheap
            // enough at the scroll-event rate a settings-panel-scale app actually produces.
            // `getBoundingClientRect()` is already viewport-relative (i.e. already reflects the current
            // scroll position) - re-adding `scrollTop` on top of that would double-count it and cancel
            // scroll position out of the math entirely, which is exactly the bug this comment is here to
            // stop a future edit from reintroducing.
            const viewTop = scrollEl.getBoundingClientRect().top - container.getBoundingClientRect().top;
            const viewportHeight = scrollEl.clientHeight;
            const start = Math.max(0, Math.floor(viewTop / rowHeightPx) - overscanRows);
            const end = Math.min(rowCount, Math.ceil((viewTop + viewportHeight) / rowHeightPx) + overscanRows);
            setRange({ start, end: Math.max(start, end) });
        };
        const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(recompute);
        };

        schedule();
        scrollEl.addEventListener("scroll", schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(scrollEl);
        ro.observe(container);

        return () => {
            if (raf) cancelAnimationFrame(raf);
            scrollEl.removeEventListener("scroll", schedule);
            ro.disconnect();
        };
    }, [container, rowCount, rowHeightPx, overscanRows]);

    // Defensive clamp: `rowCount` can shrink (a filter narrows the list) between a render and the next
    // `recompute()` tick, and stale `range` values must never slice past the new, smaller array.
    const start = Math.min(range.start, rowCount);
    const end = Math.min(Math.max(range.end, start), rowCount);
    return {
        startRow: start,
        endRow: end,
        topSpacerPx: start * rowHeightPx,
        bottomSpacerPx: (rowCount - end) * rowHeightPx,
    };
}
