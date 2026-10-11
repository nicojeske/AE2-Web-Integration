// Small pieces every GregTech hub view shares.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { GTPoll } from "../state/gt";
import { clockProgressMs, clockRemainingMs, formatSecondsLeft } from "./gtModel";
import type { RecipeClock } from "./gtModel";

/** `Date.now()`, re-rendering every `intervalMs` - for live countdowns and interpolated progress. */
export function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

/** Shortest gap between two `useNowAt` re-renders, so a very short recipe can't spin the timer. */
const MIN_TICK_MS = 50;

/**
 * `Date.now()`, re-rendering just after each moment `msUntilChange` says the shown value changes - so a
 * countdown flips right on the second instead of drifting against a fixed interval. A new `key` (a new poll)
 * reschedules.
 */
function useNowAt(msUntilChange: (now: number) => number, key: string): number {
    const [, setTick] = useState(0);
    const next = useRef(msUntilChange);
    next.current = msUntilChange;
    useEffect(() => {
        let id = 0;
        const schedule = () => {
            id = window.setTimeout(
                () => {
                    setTick((t) => t + 1);
                    schedule();
                },
                Math.max(MIN_TICK_MS, next.current(Date.now()) + 2),
            );
        };
        schedule();
        return () => clearTimeout(id);
    }, [key]);
    return Date.now();
}

const clocksKey = (clocks: RecipeClock[]) => clocks.map((c) => `${c.epoch}/${c.cycleMs}`).join(",");

/** `"12s"` until the soonest of `clocks` (at least one) finishes its pass; re-renders only itself, once a second. */
export function RecipeCountdown({
    clocks,
    prefix = "",
    suffix = "",
}: {
    clocks: RecipeClock[];
    prefix?: string;
    suffix?: string;
}) {
    const now = useNowAt(
        (t) => Math.min(...clocks.map((c) => clockRemainingMs(c, t) % 1000 || 1000)),
        clocksKey(clocks),
    );
    const left = Math.min(...clocks.map((c) => clockRemainingMs(c, now)));
    return (
        <>
            {prefix}
            {formatSecondsLeft(left)}
            {suffix}
        </>
    );
}

/** `"42%"` through `clock`'s pass; re-renders only itself, as the rounded percentage changes. */
export function RecipePercent({ clock }: { clock: RecipeClock }) {
    const step = clock.cycleMs / 100;
    const now = useNowAt((t) => step - ((clockProgressMs(clock, t) + step / 2) % step), clocksKey([clock]));
    return <>{Math.round((clockProgressMs(clock, now) / clock.cycleMs) * 100)}%</>;
}

/**
 * The loading / NOT_AVAILABLE / error states every GT view has before it has data. NOT_AVAILABLE (the
 * server lost its GT provider, or `gt_enabled` was switched off) is an empty state, never a toast.
 * Renders `children(data)` once data exists - a later failed poll keeps showing the last good data.
 */
export function GTPollState<T>({
    poll,
    what,
    children,
}: {
    poll: GTPoll<T>;
    /** Lower-case noun for the loading/error copy: "machines", "power sources", ... */
    what: string;
    children: (data: T) => ComponentChildren;
}) {
    if (poll.notAvailable) {
        return <div className="placeholder-panel">GregTech data isn't available on this server.</div>;
    }
    if (poll.data !== null) return <>{children(poll.data)}</>;
    if (poll.error) {
        return (
            <div className="placeholder-panel">
                Couldn't load {what} ({poll.error}).
            </div>
        );
    }
    return <div className="placeholder-panel">Loading {what}…</div>;
}
