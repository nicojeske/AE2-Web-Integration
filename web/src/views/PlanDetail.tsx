import { useMemo, useState } from "preact/hooks";

import { formatBytes, formatNumber } from "../api/format";
import type { JobPlanItem } from "../api/types";
import { useCpus } from "../state/cpus";
import { useHistory } from "../state/history";
import { useOrder } from "../state/order";
import { usePrefs } from "../state/prefs";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useVirtualWindow } from "../ui/useVirtualWindow";
import { CpuPicker } from "./CpuPicker";
import { CraftDetailHeader, StatCard } from "./craftDetailParts";
import { bucketPlan, estimateDuration, formatEstimate, isValidCpuForPlan, planTableRows } from "./orderModel";
import type { PlanFilter, PlanSortKey } from "./orderModel";

export interface PlanDetailProps {
    /** Called once `submit()` actually starts the job - the caller navigates to Active Jobs. */
    onSubmitted: () => void;
}

/** `.plan-table__row`'s fixed `height` (`plan.css`) - exact by construction, like Browser's table rows. */
const ROW_HEIGHT_PX = 44;
const OVERSCAN_ROWS = 6;

const COLUMNS: { key: PlanSortKey; label: string }[] = [
    { key: "name", label: "Item" },
    { key: "stored", label: "From storage" },
    { key: "requested", label: "To craft" },
    { key: "missing", label: "Missing" },
    { key: "steps", label: "Steps" },
];

/**
 * The full-page plan preview ("Preview plan" from the order modal): the whole plan as one searchable,
 * sortable table, and the CPU picker so the plan can start from here. Both the back arrow and "Discard
 * plan" cancel the job server-side - there is no way back to the modal with the same plan.
 */
export function PlanDetail({ onSubmitted }: PlanDetailProps) {
    const order = useOrder();
    const { cpus } = useCpus();
    const { entries } = useHistory();
    const { settings } = usePrefs();
    const { flow } = order;

    const [filter, setFilter] = useState<PlanFilter>("all");
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<PlanSortKey>("default");
    const [descending, setDescending] = useState(true);
    const [container, setContainer] = useState<HTMLElement | null>(null);

    const job = flow?.job ?? null;
    const rows = useMemo(
        () => (job ? planTableRows(job, { filter, search, sortKey, descending }) : []),
        [job, filter, search, sortKey, descending],
    );
    const { startRow, endRow, topSpacerPx, bottomSpacerPx } = useVirtualWindow(
        container,
        rows.length,
        ROW_HEIGHT_PX,
        OVERSCAN_ROWS,
    );

    if (!flow || !job || !flow.previewing) {
        return <div className="placeholder-panel">Loading plan…</div>;
    }

    const buckets = bucketPlan(job);
    const steps = (job.plan ?? []).reduce((sum, r) => sum + r.steps, 0);
    const estimate = estimateDuration(
        entries.filter((h) => h.sourceGridKey === flow.gridKey),
        flow.itemid,
        flow.quantity,
    );
    const fmt = (n: number) => formatNumber(n, settings.numberFormat);

    // The CPU list keeps polling while this page is open, so re-check the selected CPU is still valid
    // rather than trusting the choice made when the plan was computed.
    const selectedCpuLive = flow.selectedCpu
        ? cpus.find((c) => c.sourceGridKey === flow.gridKey && c.cpuKey === flow.selectedCpu)
        : undefined;
    const selectedStillValid = !!selectedCpuLive && isValidCpuForPlan(selectedCpuLive, job.bytesTotal, flow.itemid);
    const canStart = !job.isSimulating && selectedStillValid;
    const busy = flow.phase === "submitting";
    const noCpuReason = job.isSimulating
        ? null
        : !flow.selectedCpu
          ? `No crafting CPU has room for this plan - needs ${formatBytes(job.bytesTotal)}`
          : !selectedStillValid
            ? "The selected CPU is no longer available for this plan"
            : null;

    const onSort = (key: PlanSortKey) => {
        if (key === sortKey) setDescending((d) => !d);
        else {
            setSortKey(key);
            setDescending(key !== "name");
        }
    };

    const onStart = async () => {
        const ok = await order.submit();
        if (ok) onSubmitted();
    };

    return (
        <section className="craft-detail">
            <CraftDetailHeader
                outputItemid={flow.itemid}
                outputName={flow.itemname}
                outputQty={flow.quantity}
                subtitle="Crafting plan preview - not yet submitted"
                statusLabel={job.isSimulating ? "Simulation" : "Ready"}
                statusVariant={job.isSimulating ? "red" : "green"}
                onClose={order.discard}
                closeTitle="Discard plan"
            />

            <section className="craft-detail__stats">
                <StatCard label="Bytes">{formatBytes(job.bytesTotal)}</StatCard>
                <StatCard label="Craft steps">{fmt(steps)}</StatCard>
                <StatCard label="Missing items">{fmt(buckets.missing.length)}</StatCard>
                <StatCard label="Est. time">{estimate ? formatEstimate(estimate) : "No past runs"}</StatCard>
            </section>

            {job.isSimulating && (
                <p className="craft-detail__notice">
                    AE2 couldn&apos;t fully source this plan - {buckets.missing.length} item
                    {buckets.missing.length === 1 ? "" : "s"} missing. Starting isn&apos;t possible until they&apos;re
                    available.
                </p>
            )}

            <section className="plan-toolbar">
                <input
                    type="search"
                    className="plan-toolbar__search"
                    placeholder="Filter plan…"
                    value={search}
                    onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                />
                <SegmentedControl
                    value={filter}
                    onChange={setFilter}
                    options={[
                        { value: "all", label: `All ${job.plan?.length ?? 0}` },
                        { value: "missing", label: `Missing ${buckets.missing.length}` },
                        { value: "craft", label: `To craft ${buckets.toCraft.length}` },
                        { value: "storage", label: `From storage ${buckets.fromStorage.length}` },
                    ]}
                />
            </section>

            <div className="plan-table-wrap">
                <div className="plan-table__head">
                    {COLUMNS.map((col) => (
                        <button
                            key={col.key}
                            type="button"
                            className={cx(
                                "plan-table__sort",
                                `plan-table__cell--${col.key}`,
                                sortKey === col.key && "plan-table__sort--active",
                            )}
                            onClick={() => onSort(col.key)}
                        >
                            {col.label}
                            {sortKey === col.key && (descending ? " ↓" : " ↑")}
                        </button>
                    ))}
                    <span className="plan-table__cell--bar">Source</span>
                </div>
                {rows.length === 0 ? (
                    <div className="placeholder-panel">No rows match the filter.</div>
                ) : (
                    <section
                        className="plan-table"
                        ref={setContainer}
                        style={{ paddingTop: topSpacerPx, paddingBottom: bottomSpacerPx }}
                    >
                        {rows.slice(startRow, endRow).map((row) => (
                            <PlanRow key={row.itemid} row={row} fmt={fmt} />
                        ))}
                    </section>
                )}
            </div>

            {flow.error && <p className="craft-detail__notice craft-detail__notice--error">{flow.error}</p>}

            {!job.isSimulating && (
                <section className="plan-detail__cpus">
                    <span className="order-modal__label">Crafting CPU</span>
                    <CpuPicker
                        gridKey={flow.gridKey}
                        itemid={flow.itemid}
                        bytesTotal={job.bytesTotal}
                        selectedCpu={flow.selectedCpu}
                        onSelect={order.selectCpu}
                    />
                </section>
            )}

            <section className="craft-detail__actions-block">
                <div className="craft-detail__actions">
                    <Button variant="secondary" onClick={order.discard}>
                        Discard plan
                    </Button>
                    {!job.isSimulating && (
                        <Button variant="primary" onClick={() => void onStart()} disabled={!canStart || busy}>
                            {busy ? "Starting…" : "Start Crafting"}
                        </Button>
                    )}
                </div>
                {noCpuReason && <p className="craft-detail__cpu-warning">{noCpuReason}</p>}
            </section>
        </section>
    );
}

/** One plan row: amounts per column, and a bar splitting the row's total into storage/craft/missing. */
function PlanRow({ row, fmt }: { row: JobPlanItem; fmt: (n: number) => string }) {
    const total = row.stored + row.requested + row.missing;
    const pct = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;
    const amount = (n: number, tone: string) => (
        <span className={cx("plan-table__amount", n > 0 ? tone : "plan-table__amount--zero")}>{fmt(n)}</span>
    );
    return (
        <div className={cx("plan-table__row", row.missing > 0 && "plan-table__row--missing")}>
            <span className="plan-table__cell--name">
                <ItemIcon itemid={row.itemid} name={row.itemname} size={24} />
                <FormattedText text={row.itemname} className="plan-table__name" />
            </span>
            <span className="plan-table__cell--stored">{amount(row.stored, "plan-table__amount--teal")}</span>
            <span className="plan-table__cell--requested">{amount(row.requested, "plan-table__amount--purple")}</span>
            <span className="plan-table__cell--missing">{amount(row.missing, "plan-table__amount--red")}</span>
            <span className="plan-table__cell--steps">{amount(row.steps, "")}</span>
            <span
                className="plan-table__cell--bar plan-table__bar"
                title={row.usedPercent > 0 ? `${Math.round(row.usedPercent * 100)}% of stock` : undefined}
            >
                <span className="plan-table__bar-fill plan-table__bar-fill--teal" style={{ width: pct(row.stored) }} />
                <span
                    className="plan-table__bar-fill plan-table__bar-fill--purple"
                    style={{ width: pct(row.requested) }}
                />
                <span className="plan-table__bar-fill plan-table__bar-fill--red" style={{ width: pct(row.missing) }} />
            </span>
        </div>
    );
}
