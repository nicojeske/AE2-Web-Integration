import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/**
 * Hover/keyboard index for a Statistics sparkline or the compare chart. A sparkline has no
 * per-point elements to attach `onFocus`/`onBlur` to like `Timeline.tsx`'s rects do, so this hook
 * covers both pointer hover (design rule: `round(x/width*(count-1))`, clamped) and Arrow/Home/End
 * keyboard traversal of the plot wrapper as one thing.
 */
export interface ChartHover {
    index: number | null;
    setIndex: (i: number | null) => void;
    handlers: {
        onMouseMove: (e: MouseEvent) => void;
        onMouseLeave: () => void;
        onKeyDown: (e: KeyboardEvent) => void;
        onBlur: () => void;
    };
}

export function useChartHover(count: number): ChartHover {
    const [index, setIndexState] = useState<number | null>(null);
    const countRef = useRef(count);
    countRef.current = count;

    // A range change can shrink `count` out from under a stale hover index - clamp on every read
    // rather than trusting whatever was last set.
    const clamped = index === null ? null : Math.min(Math.max(index, 0), Math.max(0, count - 1));

    useEffect(() => {
        if (index !== null && count === 0) setIndexState(null);
    }, [count, index]);

    const setIndex = useCallback((i: number | null) => setIndexState(i), []);

    const onMouseMove = useCallback((e: MouseEvent) => {
        const n = countRef.current;
        if (n === 0) return;
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const idx = Math.round((x / rect.width) * (n - 1));
        setIndexState(Math.min(Math.max(idx, 0), n - 1));
    }, []);

    const onMouseLeave = useCallback(() => setIndexState(null), []);
    const onBlur = useCallback(() => setIndexState(null), []);

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        const n = countRef.current;
        if (n === 0) return;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            setIndexState((i) => Math.min((i ?? n - 1) + 1, n - 1));
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setIndexState((i) => Math.max((i ?? n) - 1, 0));
        } else if (e.key === "Home") {
            e.preventDefault();
            setIndexState(0);
        } else if (e.key === "End") {
            e.preventDefault();
            setIndexState(n - 1);
        } else if (e.key === "Escape") {
            setIndexState(null);
        }
    }, []);

    return { index: clamped, setIndex, handlers: { onMouseMove, onMouseLeave, onKeyDown, onBlur } };
}
