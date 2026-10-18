// Storage capacity and AE power of the selected network, from the samples taken with the item statistics:
// how full the cells are, when they run out at the range's trend, and what the network draws.
import type { ComponentChildren } from "preact";

import { getGridCapacity } from "../api/client";
import { formatDuration, formatNumber, formatPercent } from "../api/format";
import type { GridKey, StatsRange } from "../api/types";
import { useGT, useGTPoll } from "../state/gt";
import { Chart } from "../ui/Chart";

/** Run-out sooner than this is worth a warning colour. */
const SOON_MILLIS = 7 * 86_400_000;

export function NetworkCapacity({
    gridKey,
    range,
    customMinutes,
}: {
    gridKey: GridKey;
    range: StatsRange;
    customMinutes: number;
}) {
    const { nonce } = useGT();
    const minutes = range === "custom" ? customMinutes : undefined;
    const poll = useGTPoll(
        () => getGridCapacity(gridKey, range, minutes),
        60_000,
        `${gridKey}|${range}|${minutes ?? ""}`,
        nonce,
    );
    const data = poll.data;
    const now = Date.now();
    if (!data?.current) return null;
    const c = data.current;
    const timestamps = (data.series.item_bytes_used ?? []).map((_, i) => data.from + i * data.stepMillis);
    const spark = (key: string) => (
        <Chart
            values={(data.series[key] ?? []).map((v) => (v < 0 ? null : v))}
            timestamps={timestamps}
            range={range}
            spanMillis={data.to - data.from}
            width={300}
            height={28}
            ariaLabel={key.replace(/_/g, " ")}
        />
    );
    return (
        <div className="kpis capacity">
            <CapacityTile
                label="Item storage"
                used={c.itemBytesUsed}
                total={c.itemBytesTotal}
                unit="bytes"
                fullAt={data.itemBytesFullAt}
                now={now}
                chart={spark("item_bytes_used")}
            />
            <CapacityTile
                label="Item types"
                used={c.itemTypesUsed}
                total={c.itemTypesTotal}
                unit="types"
                fullAt={data.itemTypesFullAt}
                now={now}
                chart={spark("item_types_used")}
            />
            {c.fluidBytesTotal > 0 && (
                <CapacityTile
                    label="Fluid storage"
                    used={c.fluidBytesUsed}
                    total={c.fluidBytesTotal}
                    unit="bytes"
                    fullAt={data.fluidBytesFullAt}
                    now={now}
                    chart={spark("fluid_bytes_used")}
                />
            )}
            <div className="kpi">
                <span className="section-label">AE power</span>
                <span className="kpi__value">{formatNumber(Math.round(c.powerUsage))} AE/t</span>
                <span className="kpi__sub">
                    {c.powerMax > 0
                        ? `${formatPercent(c.powerStored / c.powerMax)} of ${formatNumber(Math.round(c.powerMax))} AE stored`
                        : "No energy storage"}
                    {c.powerInjection > 0 && ` · ${formatNumber(Math.round(c.powerInjection))} AE/t in`}
                </span>
                {spark("power_usage")}
            </div>
        </div>
    );
}

function CapacityTile({
    label,
    used,
    total,
    unit,
    fullAt,
    now,
    chart,
}: {
    label: string;
    used: number;
    total: number;
    unit: string;
    fullAt: number | null;
    now: number;
    chart: ComponentChildren;
}) {
    const share = total > 0 ? used / total : 0;
    const soon = fullAt !== null && fullAt - now < SOON_MILLIS;
    return (
        <div className="kpi">
            <span className="section-label">{label}</span>
            <span className={share >= 0.9 || soon ? "kpi__value amber" : "kpi__value"}>
                {total > 0 ? `${Math.round(share * 100)}%` : "—"}
            </span>
            <span className="kpi__sub">
                {formatNumber(used, "compact")} of {formatNumber(total, "compact")} {unit}
                {fullAt !== null &&
                    (fullAt <= now ? " · full at this rate" : ` · full in ~${formatDuration(fullAt - now)}`)}
            </span>
            {chart}
        </div>
    );
}
