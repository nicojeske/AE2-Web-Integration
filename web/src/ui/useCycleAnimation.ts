import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";

/** A repeating fill: one pass takes `cycleMs`, and a pass began at wall time `epoch`. */
export interface FillCycle {
    cycleMs: number;
    epoch: number;
}

/**
 * Grows `ref` from `scaleX(0)` to `scaleX(1)` once per `cycle`, phased to it, as a Web Animation - it runs on
 * the compositor, so a progress fill glides at frame rate without its component re-rendering. Restarts only
 * when the cycle itself changes (a new poll), never on an unrelated re-render.
 */
export function useCycleAnimation(ref: RefObject<Element>, cycle: FillCycle | null | undefined): void {
    const cycleMs = cycle?.cycleMs ?? 0;
    const epoch = cycle?.epoch ?? 0;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || cycleMs <= 0 || typeof el.animate !== "function") return;
        const animation = el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
            duration: cycleMs,
            iterations: Infinity,
        });
        const sync = () => {
            animation.currentTime = (((Date.now() - epoch) % cycleMs) + cycleMs) % cycleMs;
        };
        sync();
        // A background tab's animation clock stands still; catch up to the wall clock on coming back.
        document.addEventListener("visibilitychange", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            animation.cancel();
        };
    }, [ref, cycleMs, epoch]);
}
