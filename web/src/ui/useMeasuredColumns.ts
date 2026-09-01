import { useEffect, useState } from "preact/hooks";

/**
 * Mirrors `repeat(auto-fill, minmax(tileMinPx, 1fr))` with `gapPx` between tiles - the exact CSS
 * `.item-grid` already uses (`browser.css`) - so windowing (`useVirtualWindow`) groups items into the
 * same rows the grid actually renders. Measured via `ResizeObserver` rather than assumed, since
 * `--tile-min` (the Settings modal) and the responsive breakpoints can both change the container width
 * or the tile size at any time.
 *
 * Takes the container as a plain nullable value (state, not a `RefObject`) rather than reading a ref's
 * `.current` itself - a plain ref isn't reactive, so an effect keyed on `tileMinPx`/`gapPx` (which
 * rarely change) would only ever see whichever value `.current` held the one time it happened to run,
 * and never retry once the container mounts later (e.g. behind a loading placeholder on first render).
 * The caller owns the element via a callback ref into `useState`, so this effect re-runs - and finds the
 * real element - the moment it actually appears.
 */
export function useMeasuredColumns(container: HTMLElement | null, tileMinPx: number, gapPx: number): number {
    const [columns, setColumns] = useState(1);

    useEffect(() => {
        if (!container) return;
        const recompute = () => {
            const width = container.clientWidth;
            if (width <= 0) return;
            setColumns(Math.max(1, Math.floor((width + gapPx) / (tileMinPx + gapPx))));
        };
        recompute();
        const ro = new ResizeObserver(recompute);
        ro.observe(container);
        return () => ro.disconnect();
    }, [container, tileMinPx, gapPx]);

    return columns;
}
