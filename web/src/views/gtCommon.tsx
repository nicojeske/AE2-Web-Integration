// Small pieces every GregTech hub view shares.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { GTPoll } from "../state/gt";

/** `Date.now()`, re-rendering every `intervalMs` - for live countdowns and interpolated progress. */
export function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
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
