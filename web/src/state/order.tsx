// The order/plan flow state machine (M4): quantity -> calculating -> plan -> submitting. A provider
// (not local Browser state) because the plan preview is a full page that outlives the order modal, and
// a future auto-craft driver (M6) needs to drive the same order -> plan -> submit chain headlessly.
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { cancelJob, submitJob } from "../api/client";
import { describeApiError } from "../api/errors";
import type { JobData } from "../api/types";
import { clampQuantity, pickDefaultCpu } from "../views/orderModel";
import { computePlan } from "./craftChain";
import { useCpus } from "./cpus";
import { useToast } from "./toast";

export type OrderPhase = "quantity" | "calculating" | "plan" | "submitting";

export interface OrderFlow {
    gridId: number;
    gridLabel: string;
    itemid: string;
    /** Raw, possibly §-formatted item name - render via `<FormattedText>`, never as a plain string. */
    itemname: string;
    quantity: number;
    phase: OrderPhase;
    jobId: number | null;
    /** Only set once `calculate()` reaches a `isDone` response. */
    job: JobData | null;
    selectedCpu: string | null;
    error: string | null;
    /** `false` while the order modal is showing; `true` once "Preview plan" swaps in the full-page view. */
    previewing: boolean;
    calcStartedAt: number;
}

export interface StartOrderItem {
    sourceGridId: number;
    gridLabel: string;
    itemid: string;
    itemname: string;
}

const DEFAULT_QUANTITY = 64;

export interface OrderContextValue {
    flow: OrderFlow | null;
    startOrder: (item: StartOrderItem) => void;
    setQuantity: (n: number) => void;
    calculate: () => void;
    selectCpu: (name: string) => void;
    openPreview: () => void;
    closePreview: () => void;
    submit: () => Promise<boolean>;
    /** Cancels any in-flight/computed job server-side (if any) and clears the flow. */
    discard: () => void;
}

const OrderContext = createContext<OrderContextValue | null>(null);

export function OrderProvider({ children }: { children?: ComponentChildren }) {
    const { cpus, refresh: refreshCpus } = useCpus();
    const toast = useToast();
    const [flow, setFlow] = useState<OrderFlow | null>(null);

    // "Latest ref" mirrors so the async calculate() chain (which spans several awaits/ticks) always
    // reads current values instead of the snapshot captured when it started.
    const flowRef = useRef(flow);
    flowRef.current = flow;
    const cpusRef = useRef(cpus);
    cpusRef.current = cpus;
    // Bumped on every action that supersedes an in-flight calculate() (new order, quantity change,
    // discard, unmount) so a stale poll loop notices and stops touching state instead of racing ahead.
    const generationRef = useRef(0);

    const cancelPending = useCallback((jobId: number | null, gridId: number) => {
        if (jobId === null) return;
        // Best-effort: an already-finished/expired job answers INVALID_ID, nothing to clean up.
        void cancelJob(gridId, jobId).catch(() => {});
    }, []);

    const discard = useCallback(() => {
        generationRef.current++;
        const current = flowRef.current;
        if (current) cancelPending(current.jobId, current.gridId);
        setFlow(null);
    }, [cancelPending]);

    useEffect(() => {
        return () => {
            generationRef.current++;
            const current = flowRef.current;
            if (current) cancelPending(current.jobId, current.gridId);
        };
        // Intentionally empty deps: this effect's cleanup only ever needs to run once, on unmount.
    }, []);

    // Best-effort cleanup if the tab closes mid-plan - GridData's job map has no idle expiry, so a
    // computed-but-abandoned plan would otherwise sit there until the server restarts.
    useEffect(() => {
        const onPageHide = () => {
            const current = flowRef.current;
            if (!current || current.jobId === null) return;
            const url = `job?grid=${current.gridId}&id=${current.jobId}&cancel`;
            if (navigator.sendBeacon) navigator.sendBeacon(url);
            else void fetch(url, { keepalive: true }).catch(() => {});
        };
        window.addEventListener("pagehide", onPageHide);
        return () => window.removeEventListener("pagehide", onPageHide);
    }, []);

    const startOrder = useCallback((item: StartOrderItem) => {
        generationRef.current++;
        setFlow({
            gridId: item.sourceGridId,
            gridLabel: item.gridLabel,
            itemid: item.itemid,
            itemname: item.itemname,
            quantity: DEFAULT_QUANTITY,
            phase: "quantity",
            jobId: null,
            job: null,
            selectedCpu: null,
            error: null,
            previewing: false,
            calcStartedAt: 0,
        });
    }, []);

    const setQuantity = useCallback(
        (n: number) => {
            const current = flowRef.current;
            if (!current) return;
            generationRef.current++; // supersede any in-flight calculate()
            cancelPending(current.jobId, current.gridId); // a computed plan is for the old quantity
            setFlow({
                ...current,
                quantity: clampQuantity(n),
                phase: "quantity",
                jobId: null,
                job: null,
                selectedCpu: null,
                error: null,
                previewing: false,
            });
        },
        [cancelPending],
    );

    const calculate = useCallback(() => {
        const snapshot = flowRef.current;
        if (!snapshot) return;
        const generation = ++generationRef.current;
        setFlow((f) => (f ? { ...f, phase: "calculating", error: null, calcStartedAt: Date.now() } : f));

        void (async () => {
            try {
                const handle = await computePlan(
                    { gridId: snapshot.gridId, itemid: snapshot.itemid, quantity: snapshot.quantity },
                    {
                        isStale: () => generationRef.current !== generation,
                        onJobId: (jobId) => setFlow((f) => (f ? { ...f, jobId } : f)),
                    },
                );
                if (!handle) return; // superseded

                // Fresh /list so CPU validation runs against current storage, not a snapshot from
                // before the plan was computed.
                await refreshCpus();
                if (generationRef.current !== generation) return;
                const candidates = cpusRef.current.filter((c) => c.sourceGridId === snapshot.gridId);
                const defaultCpu = pickDefaultCpu(candidates, handle.job.bytesTotal, snapshot.itemid);
                setFlow((f) =>
                    f ? { ...f, phase: "plan", job: handle.job, selectedCpu: defaultCpu, error: null } : f,
                );
            } catch (e) {
                if (generationRef.current !== generation) return;
                // describeApiError already falls back to e.message for a plain Error (e.g. craftChain's
                // ItemGoneError/PlanTimeoutError), matching the original inline copy for each.
                setFlow((f) =>
                    f ? { ...f, phase: "quantity", error: describeApiError(e, "Failed to calculate plan") } : f,
                );
            }
        })();
    }, [refreshCpus]);

    const selectCpu = useCallback((name: string) => {
        setFlow((f) => (f && f.phase === "plan" ? { ...f, selectedCpu: name } : f));
    }, []);

    const openPreview = useCallback(() => {
        setFlow((f) => (f && f.phase === "plan" ? { ...f, previewing: true } : f));
    }, []);

    const closePreview = useCallback(() => {
        setFlow((f) => (f ? { ...f, previewing: false } : f));
    }, []);

    const submit = useCallback(async (): Promise<boolean> => {
        const snapshot = flowRef.current;
        if (!snapshot || snapshot.jobId === null || !snapshot.selectedCpu || snapshot.job?.isSimulating) {
            return false;
        }
        setFlow((f) => (f ? { ...f, phase: "submitting", error: null } : f));
        try {
            await submitJob(snapshot.gridId, snapshot.jobId, snapshot.selectedCpu);
            toast(`Crafting job started on ${snapshot.selectedCpu}`);
            generationRef.current++;
            setFlow(null);
            void refreshCpus();
            return true;
        } catch (e) {
            setFlow((f) => (f ? { ...f, phase: "plan", error: describeApiError(e, "Failed to submit job") } : f));
            return false;
        }
    }, [toast, refreshCpus]);

    const value = useMemo<OrderContextValue>(
        () => ({ flow, startOrder, setQuantity, calculate, selectCpu, openPreview, closePreview, submit, discard }),
        [flow, startOrder, setQuantity, calculate, selectCpu, openPreview, closePreview, submit, discard],
    );

    return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderContextValue {
    const ctx = useContext(OrderContext);
    if (!ctx) throw new Error("useOrder must be used within an OrderProvider");
    return ctx;
}
