import { useEffect, useState } from "preact/hooks";

import { formatBytes } from "../api/format";
import { useCpus } from "../state/cpus";
import { useOrder } from "../state/order";
import { Button } from "../ui/Button";
import { FormattedText } from "../ui/FormattedText";
import { ItemIcon } from "../ui/ItemIcon";
import { Modal } from "../ui/Modal";
import { cpuRow } from "./orderModel";

const QTY_STEPS_MINUS = [-512, -64, -1];
const QTY_STEPS_PLUS = [1, 64, 512];

export interface OrderModalProps {
    /** Called once `submit()` actually starts the job - the caller navigates to Active Jobs. */
    onSubmitted: () => void;
}

/**
 * The 480px order modal. Always mounted at shell level and renders nothing when there's no in-progress
 * order or once "Preview plan" has swapped in the full-page `PlanDetail` (`flow.previewing`).
 */
export function OrderModal({ onSubmitted }: OrderModalProps) {
    const order = useOrder();
    const { cpus } = useCpus();
    const { flow } = order;
    const [now, setNow] = useState(Date.now());

    // Ticks the "Calculating…" elapsed readout - a big plan can genuinely take a while since `job` is a
    // synced request on the server thread.
    useEffect(() => {
        if (!flow || flow.phase !== "calculating") return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [flow?.phase]);

    if (!flow || flow.previewing) return null;

    const bytesTotal = flow.job?.bytesTotal ?? 0;
    const gridCpus = cpus.filter((c) => c.sourceGridId === flow.gridId);
    const rows =
        flow.phase === "plan" && flow.job && !flow.job.isSimulating
            ? gridCpus.map((c) => cpuRow(c, bytesTotal, flow.itemid, flow.selectedCpu))
            : [];
    const elapsedSeconds = Math.max(0, Math.round((now - flow.calcStartedAt) / 1000));
    const busy = flow.phase === "submitting";

    const onClose = () => order.discard();

    const onStart = async () => {
        const ok = await order.submit();
        if (ok) onSubmitted();
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
                        <span className="order-modal__sub">Submit crafting request</span>
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
                    <Button
                        variant="primary"
                        onClick={() => void onStart()}
                        disabled={flow.phase !== "plan" || !flow.selectedCpu || flow.job?.isSimulating || busy}
                    >
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
                        value={flow.quantity}
                        onInput={(e) => order.setQuantity(Number((e.target as HTMLInputElement).value))}
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
            </div>

            <div className="order-modal__section">
                <span className="order-modal__label">Crafting CPU</span>
                {flow.phase === "quantity" && (
                    <Button variant="secondary" onClick={order.calculate}>
                        Calculate plan
                    </Button>
                )}
                {flow.phase === "calculating" && (
                    <p className="order-modal__calculating">Calculating plan… {elapsedSeconds}s</p>
                )}
                {flow.phase === "plan" && flow.job?.isSimulating && (
                    <p className="order-modal__notice">
                        AE2 couldn&apos;t fully source this from what&apos;s available - preview the plan to see
                        what&apos;s missing.
                    </p>
                )}
                {flow.phase === "plan" && flow.job && !flow.job.isSimulating && (
                    <>
                        {rows.length === 0 ? (
                            <p className="order-modal__notice">This network has no crafting CPUs.</p>
                        ) : (
                            <div className="order-modal__cpu-list">
                                {rows.map((row) => (
                                    <button
                                        key={row.name}
                                        type="button"
                                        className={`order-modal__cpu-row order-modal__cpu-row--${row.state}${
                                            row.selected ? " order-modal__cpu-row--selected" : ""
                                        }`}
                                        disabled={!row.selectable}
                                        onClick={() => order.selectCpu(row.name)}
                                    >
                                        <span className="order-modal__cpu-row-head">
                                            <span>{row.name}</span>
                                            <span className="order-modal__cpu-tag">{row.tag}</span>
                                        </span>
                                        <span className="order-modal__cpu-row-detail">{row.detail}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="order-modal__bytes">Bytes: {formatBytes(bytesTotal)}</p>
                    </>
                )}
                {flow.phase === "submitting" && <p className="order-modal__calculating">Submitting job…</p>}
            </div>

            {flow.error && <p className="order-modal__error">{flow.error}</p>}
        </Modal>
    );
}
