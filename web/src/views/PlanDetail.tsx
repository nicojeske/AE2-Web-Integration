import { formatBytes } from "../api/format";
import { useCpus } from "../state/cpus";
import { useOrder } from "../state/order";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { CraftDetailColumns, CraftDetailHeader, StatCard } from "./craftDetailParts";
import { buildPlanDetail, isValidCpuForPlan } from "./orderModel";

export interface PlanDetailProps {
    /** Called once `submit()` actually starts the job - the caller navigates to Active Jobs. */
    onSubmitted: () => void;
}

/**
 * The full-page plan preview ("Preview plan" from the order modal). Mounted whenever
 * `useOrder().flow?.previewing` is true - see `App.tsx`'s `Shell`. Both the header's back arrow and the
 * "Discard plan" footer button cancel the job server-side before leaving: unlike the design prototype
 * (whose back button just clears local state, orphaning the computed job), there is no path back to the
 * order modal to keep the plan, since submitting a stale CPU choice from a discarded plan makes no sense.
 */
export function PlanDetail({ onSubmitted }: PlanDetailProps) {
    const order = useOrder();
    const { cpus } = useCpus();
    const { flow } = order;

    if (!flow || !flow.job || !flow.previewing) {
        return <div className="placeholder-panel">Loading plan…</div>;
    }

    const job = flow.job;
    const view = buildPlanDetail(job);
    // `/list` keeps polling in the background while this page is open (M2's poller isn't scoped to a
    // section), so re-check the selected CPU is still valid rather than trusting the choice made back
    // when the plan was first computed - it can go idle-to-busy-elsewhere or lose the storage headroom
    // in the meantime.
    const selectedCpuLive = flow.selectedCpu
        ? cpus.find((c) => c.sourceGridId === flow.gridId && c.name === flow.selectedCpu)
        : undefined;
    const selectedStillValid = !!selectedCpuLive && isValidCpuForPlan(selectedCpuLive, view.bytesTotal, flow.itemid);
    const canStart = !job.isSimulating && selectedStillValid;
    const busy = flow.phase === "submitting";
    const noCpuReason = job.isSimulating
        ? null
        : !flow.selectedCpu
          ? `No crafting CPU has room for this plan - needs ${formatBytes(view.bytesTotal)}`
          : !selectedStillValid
            ? "The selected CPU is no longer available for this plan"
            : null;

    const onDiscard = () => order.discard();

    const onStart = async () => {
        const ok = await order.submit();
        if (ok) onSubmitted();
    };

    return (
        <section className="craft-detail">
            <CraftDetailHeader
                outputName={flow.itemname}
                outputQty={flow.quantity}
                subtitle="Crafting plan preview - not yet submitted"
                statusLabel={view.statusLabel}
                statusVariant={view.statusVariant}
                onClose={onDiscard}
                closeTitle="Discard plan"
            />

            <section className="craft-detail__stats">
                <StatCard label="Output">
                    <FormattedText text={flow.itemname} /> x{flow.quantity.toLocaleString("en-US")}
                </StatCard>
                {view.stats.map((st) => (
                    <StatCard key={st.label} label={st.label}>
                        {st.value}
                    </StatCard>
                ))}
            </section>

            <CraftDetailColumns columns={view.columns} />

            {job.isSimulating && (
                <p className="craft-detail__notice">
                    AE2 couldn&apos;t fully source this plan - {view.missingCount} item
                    {view.missingCount === 1 ? "" : "s"} missing. Starting isn&apos;t possible until they&apos;re
                    available.
                </p>
            )}

            {flow.error && <p className="craft-detail__notice craft-detail__notice--error">{flow.error}</p>}

            <section className="craft-detail__actions-block">
                <div className="craft-detail__actions">
                    <Button variant="secondary" onClick={onDiscard}>
                        Discard plan
                    </Button>
                    {!job.isSimulating && (
                        <Button variant="primary" onClick={() => void onStart()} disabled={!canStart || busy}>
                            {busy ? "Starting…" : view.missingCount > 0 ? "Start anyway" : "Start Crafting"}
                        </Button>
                    )}
                </div>
                {noCpuReason && <p className="craft-detail__cpu-warning">{noCpuReason}</p>}
            </section>
        </section>
    );
}
