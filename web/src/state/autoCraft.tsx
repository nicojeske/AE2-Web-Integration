// The M6 auto-craft driver: headlessly runs the real items -> order -> job -> submit chain (craftChain.ts)
// for favourites that have fallen below their keepStock. Deliberately does NOT consume useOrder() - that
// provider is a single UI slot (one flow at a time, OrderModal renders for whatever flow exists), so
// touching it here would pop the order modal open on the user or clobber a manual order in progress.
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { cancelJob, submitJob } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import { pickDefaultCpu } from "../views/orderModel";
import { computePlan } from "./craftChain";
import type { CpuView } from "./cpus";
import { useCpus } from "./cpus";
import type { BrowserItem } from "./items";
import { useItems } from "./items";
import { useNetwork } from "./network";
import { prefsKey, usePrefs } from "./prefs";
import type { Thresholds } from "./prefs";
import { useToast } from "./toast";

/** Don't retry a failed candidate (simulating plan, no valid CPU, ALL_CPU_BUSY, timeout, ...) for 5
 *  minutes - the milestone's required guard against a retry storm on a plan that keeps simulating. */
const BACKOFF_MS = 5 * 60_000;

interface AutoCraftCandidate {
    key: string;
    gridId: number;
    itemid: string;
    itemname: string;
    quantity: number;
}

/**
 * Favourites with `autoCraft` and `stored < keepStock`, minus ones already being crafted (a busy CPU on
 * the same grid already outputting this itemid - available from `/list` alone, no `/get` needed) or
 * currently in backoff. Order follows `items`' own order, which is stable enough for "first eligible
 * candidate this cycle" - there is no priority concept in the design.
 */
function findCandidates(
    items: BrowserItem[],
    cpus: CpuView[],
    favorites: Record<string, true>,
    thresholds: Record<string, Thresholds>,
    backoff: Map<string, number>,
    now: number,
): AutoCraftCandidate[] {
    const out: AutoCraftCandidate[] = [];
    for (const item of items) {
        const key = prefsKey(item.sourceGridId, item.itemid);
        if (!favorites[key]) continue;
        const cfg = thresholds[key];
        if (!cfg?.autoCraft) continue;
        if (item.quantity >= cfg.keepStock) continue;
        if ((backoff.get(key) ?? 0) > now) continue;
        const alreadyCrafting = cpus.some(
            (c) => c.sourceGridId === item.sourceGridId && c.isBusy && c.finalOutput?.itemid === item.itemid,
        );
        if (alreadyCrafting) continue;
        const quantity = Math.max(1, Math.min(cfg.batchSize, cfg.keepStock - item.quantity));
        out.push({ key, gridId: item.sourceGridId, itemid: item.itemid, itemname: item.itemname, quantity });
    }
    return out;
}

export function AutoCraftProvider({ children }: { children?: ComponentChildren }) {
    const { selected } = useNetwork();
    const { items } = useItems();
    const { cpus, refresh: refreshCpus } = useCpus();
    const { favorites, thresholds } = usePrefs();
    const toast = useToast();

    // "Latest ref" mirrors, same pattern as order.tsx/cpus.tsx - the async chain and the timers below
    // must read current values without restarting on every render.
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const cpusRef = useRef(cpus);
    cpusRef.current = cpus;
    const favoritesRef = useRef(favorites);
    favoritesRef.current = favorites;
    const thresholdsRef = useRef(thresholds);
    thresholdsRef.current = thresholds;
    const toastRef = useRef(toast);
    toastRef.current = toast;

    // Bumped when a grid switch (or unmount) supersedes an in-flight chain, mirroring order.tsx's own
    // generation guard.
    const generationRef = useRef(0);
    // At most one chain in flight globally - every step is a synced request on the server thread under
    // CoreEngine's 5ms/tick drain budget and the 32-slot AE2Controller.requests queue.
    const inFlightRef = useRef(false);
    const backoffRef = useRef<Map<string, number>>(new Map());
    // The one computed-but-not-yet-submitted (or not-yet-cancelled) job, if any - cleaned up on grid
    // switch, unmount, and tab close, since GridData's job map has no idle expiry of its own.
    const pendingRef = useRef<{ gridId: number; jobId: number } | null>(null);

    const cancelPending = useCallback(() => {
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        void cancelJob(pending.gridId, pending.jobId).catch(() => {});
    }, []);

    // A grid switch invalidates any chain computed against the old grid's CPUs/storage; unmount needs
    // the same cleanup. Cleanup (not the effect body) does the work so it fires on both transitions.
    useEffect(() => {
        return () => {
            generationRef.current++;
            cancelPending();
        };
    }, [selected, cancelPending]);

    // Best-effort cleanup if the tab closes mid-chain, same shape as order.tsx's own pagehide handler.
    useEffect(() => {
        const onPageHide = () => {
            const pending = pendingRef.current;
            if (!pending) return;
            const url = `job?grid=${pending.gridId}&id=${pending.jobId}&cancel`;
            if (navigator.sendBeacon) navigator.sendBeacon(url);
            else void fetch(url, { keepalive: true }).catch(() => {});
        };
        window.addEventListener("pagehide", onPageHide);
        return () => window.removeEventListener("pagehide", onPageHide);
    }, []);

    const runCycle = useCallback(async () => {
        if (inFlightRef.current || document.hidden) return;
        const now = Date.now();
        const candidate = findCandidates(
            itemsRef.current,
            cpusRef.current,
            favoritesRef.current,
            thresholdsRef.current,
            backoffRef.current,
            now,
        )[0];
        if (!candidate) return;

        inFlightRef.current = true;
        const generation = generationRef.current;
        const fail = () => {
            cancelPending();
            backoffRef.current.set(candidate.key, now + BACKOFF_MS);
        };
        try {
            const handle = await computePlan(
                { gridId: candidate.gridId, itemid: candidate.itemid, quantity: candidate.quantity },
                {
                    isStale: () => generationRef.current !== generation,
                    onJobId: (jobId) => {
                        pendingRef.current = { gridId: candidate.gridId, jobId };
                    },
                },
            );
            if (!handle) return; // superseded - the generation-bump cleanup already cancelled it

            if (handle.job.isSimulating) {
                fail(); // never submittable, caveat 5 - back off rather than recomputing forever
                return;
            }

            // Fresh /list so CPU validation runs against current storage, not a snapshot from before
            // the plan was computed.
            await refreshCpus();
            if (generationRef.current !== generation) return;
            const gridCpus = cpusRef.current.filter((c) => c.sourceGridId === candidate.gridId);
            const cpuName = pickDefaultCpu(gridCpus, handle.job.bytesTotal, candidate.itemid);
            if (!cpuName) {
                fail();
                return;
            }

            await submitJob(candidate.gridId, handle.jobId, cpuName);
            pendingRef.current = null;
            backoffRef.current.delete(candidate.key);
            toastRef.current(
                `Auto-crafting ${candidate.quantity}x ${skipSpecialFormat(candidate.itemname)} on ${cpuName}`,
            );
            void refreshCpus();
        } catch {
            fail();
        } finally {
            inFlightRef.current = false;
        }
    }, [refreshCpus, cancelPending]);

    // Piggybacks on the two polls that already exist rather than running a timer of its own: the CPU
    // poller's tick (which itself pauses while document.hidden) and items.tsx's own poll (M11) - which
    // arms itself whenever `hasAutoCraftFavorite` holds, same test this used to run here directly, so
    // this effect still fires shortly after either changes with no separate timer of its own to own.
    useEffect(() => {
        void runCycle();
    }, [items, cpus, runCycle]);

    return <>{children}</>;
}
