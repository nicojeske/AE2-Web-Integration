import { useEffect, useState } from "preact/hooks";

import { formatBytes, formatNumber } from "../api/format";
import { useHistory } from "../state/history";
import { useItems } from "../state/items";
import { useOrder } from "../state/order";
import { prefsKey, usePrefs } from "../state/prefs";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { Modal } from "../ui/Modal";
import { CpuPicker } from "./CpuPicker";
import { bucketPlan, clampQuantity, estimateDuration, formatEstimate } from "./orderModel";

const QTY_STEPS_MINUS = [-512, -64, -1];
const QTY_STEPS_PLUS = [1, 64, 512];
/** Missing items listed inline before "Preview plan" has to take over. */
const MISSING_SHOWN = 3;

export interface OrderModalProps {
    /** Called once `submit()` actually starts the job - the caller navigates to Active Jobs. */
    onSubmitted: () => void;
}

/**
 * The 480px order modal. Always mounted at shell level and renders nothing when there's no in-progress
 * order or once "Preview plan" has swapped in the full-page `PlanDetail` (`flow.previewing`). The plan
 * is calculated on its own once the quantity settles (`state/order.tsx`).
 */
export function OrderModal({ onSubmitted }: OrderModalProps) {
    const order = useOrder();
    const { entries: history } = useHistory();
    const { items } = useItems();
    const { thresholds, settings } = usePrefs();
    const { flow } = order;
    const [now, setNow] = useState(Date.now());
    // The input's own text, so it can be emptied while typing - only a valid number reaches the order.
    const [draft, setDraft] = useState("");

    // Ticks the "Calculating…" elapsed readout - a big plan can genuinely take a while.
    useEffect(() => {
        if (!flow || flow.phase !== "calculating") return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [flow?.phase]);

    // Follows the stepper buttons and the clamp, but leaves a draft alone that already means this number.
    const quantity = flow?.quantity;
    useEffect(() => {
        if (quantity !== undefined) setDraft((d) => (Number(d) === quantity ? d : String(quantity)));
    }, [quantity]);

    if (!flow || flow.previewing) return null;

    const key = prefsKey(flow.gridKey, flow.itemid);
    const stored = items.find((it) => it.sourceGridKey === flow.gridKey && it.itemid === flow.itemid)?.quantity;
    const keepStock = thresholds[key]?.keepStock ?? 0;
    const topUp = stored !== undefined && keepStock > stored ? keepStock - stored : 0;

    const job = flow.phase === "plan" || flow.phase === "submitting" ? flow.job : null;
    const bytesTotal = job?.bytesTotal ?? 0;
    const buckets = job ? bucketPlan(job) : null;
    // Only the plan's own grid - a run elsewhere says little about this network's machines.
    const estimate = job
        ? estimateDuration(
              history.filter((h) => h.sourceGridKey === flow.gridKey),
              flow.itemid,
              flow.quantity,
          )
        : null;
    const elapsedSeconds = Math.max(0, Math.round((now - flow.calcStartedAt) / 1000));
    const busy = flow.phase === "submitting";
    const canStart = flow.phase === "plan" && !!flow.selectedCpu && !job?.isSimulating;

    const onClose = () => order.discard();

    const onStart = async () => {
        const ok = await order.submit();
        if (ok) onSubmitted();
    };

    const onDraftInput = (value: string) => {
        setDraft(value);
        const n = Number(value);
        if (value.trim() === "" || !Number.isFinite(n) || n < 1) return;
        if (clampQuantity(n) !== flow.quantity) order.setQuantity(clampQuantity(n));
    };

    return (
        <Modal
            onClose={onClose}
            width={480}
            header={
                <>
                    <ItemIcon itemid={flow.itemid} name={flow.itemname} size={38} className="order-modal__icon" />
                    <div className="order-modal__heading">
                        <FormattedText text={flow.itemname} className="order-modal__name" />
                        <span className="order-modal__sub">
                            {stored === undefined
                                ? "Submit crafting request"
                                : `${formatNumber(stored, settings.numberFormat)} stored`}
                        </span>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </>
            }
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button variant="secondary" onClick={order.openPreview} disabled={flow.phase !== "plan" || busy}>
                        Preview plan
                    </Button>
                    <Button variant="primary" onClick={() => void onStart()} disabled={!canStart || busy}>
                        {busy ? "Starting…" : "Start Crafting"}
                    </Button>
                </>
            }
        >
            <div className="order-modal__section">
                <span className="order-modal__label">Quantity</span>
                <div className="order-modal__stepper">
                    {QTY_STEPS_MINUS.map((delta) => (
                        <button
                            key={delta}
                            type="button"
                            className="order-modal__step"
                            onClick={() => order.setQuantity(flow.quantity + delta)}
                        >
                            {delta}
                        </button>
                    ))}
                    <input
                        type="number"
                        min={1}
                        className="order-modal__qty-input"
                        value={draft}
                        onInput={(e) => onDraftInput((e.target as HTMLInputElement).value)}
                        onBlur={() => setDraft(String(flow.quantity))}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && canStart && !busy) void onStart();
                        }}
                    />
                    {QTY_STEPS_PLUS.map((delta) => (
                        <button
                            key={delta}
                            type="button"
                            className="order-modal__step"
                            onClick={() => order.setQuantity(flow.quantity + delta)}
                        >
                            +{delta}
                        </button>
                    ))}
                </div>
                {topUp > 0 && (
                    <button type="button" className="order-modal__topup" onClick={() => order.setQuantity(topUp)}>
                        Top up to keep-stock {formatNumber(keepStock, settings.numberFormat)} (+
                        {formatNumber(topUp, settings.numberFormat)})
                    </button>
                )}
            </div>

            <div className="order-modal__section">
                <span className="order-modal__label">Plan</span>
                {flow.phase === "quantity" && !flow.error && (
                    <p className="order-modal__calculating">Waiting for the quantity…</p>
                )}
                {flow.phase === "calculating" && (
                    <p className="order-modal__calculating">Calculating plan… {elapsedSeconds}s</p>
                )}
                {job && buckets && (
                    <div className="order-modal__chips">
                        <span className="order-modal__chip">{formatBytes(bytesTotal)}</span>
                        <span className="order-modal__chip order-modal__chip--purple">
                            {buckets.toCraft.length} to craft
                        </span>
                        <span className="order-modal__chip order-modal__chip--teal">
                            {buckets.fromStorage.length} from storage
                        </span>
                        {buckets.missing.length > 0 && (
                            <span className="order-modal__chip order-modal__chip--red">
                                {buckets.missing.length} missing
                            </span>
                        )}
                        {estimate && <span className="order-modal__chip">{formatEstimate(estimate)}</span>}
                    </div>
                )}
                {job?.isSimulating && buckets && (
                    <div className="order-modal__missing">
                        {buckets.missing.slice(0, MISSING_SHOWN).map((row) => (
                            <div className="order-modal__missing-row" key={row.itemid}>
                                <ItemIcon itemid={row.itemid} name={row.itemname} size={22} />
                                <FormattedText text={row.itemname} className="order-modal__missing-name" />
                                <span className="order-modal__missing-amount">
                                    need {formatNumber(row.stored + row.missing, settings.numberFormat)}, have{" "}
                                    {formatNumber(row.stored, settings.numberFormat)}
                                </span>
                            </div>
                        ))}
                        {buckets.missing.length > MISSING_SHOWN && (
                            <span className="order-modal__missing-more">
                                +{buckets.missing.length - MISSING_SHOWN} more - preview the plan for all of them
                            </span>
                        )}
                    </div>
                )}
            </div>

            {job && !job.isSimulating && (
                <div className="order-modal__section">
                    <span className="order-modal__label">Crafting CPU</span>
                    <CpuPicker
                        gridKey={flow.gridKey}
                        itemid={flow.itemid}
                        bytesTotal={bytesTotal}
                        selectedCpu={flow.selectedCpu}
                        onSelect={order.selectCpu}
                    />
                </div>
            )}

            {busy && <p className="order-modal__calculating">Submitting job…</p>}

            {flow.error && (
                <div className="order-modal__error-row">
                    <p className="order-modal__error">{flow.error}</p>
                    {flow.phase === "quantity" && (
                        <Button variant="secondary" size="sm" onClick={order.calculate}>
                            Retry
                        </Button>
                    )}
                </div>
            )}
        </Modal>
    );
}
