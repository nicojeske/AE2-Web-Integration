// Amount+unit control for the Statistics range control's "Custom" option (M8 follow-up). Draft/commit
// on blur/Enter follows Favorites.tsx's NumberField - the unit select commits immediately since it
// isn't free text.
import { useState } from "preact/hooks";

import { type CustomRangeUnit, customRangeToMinutes } from "./statsModel";

export interface CustomRangeInputProps {
    /** Current span in minutes (the wire value); decomposed once into its own amount+unit on mount. */
    minutes: number;
    onChange: (minutes: number) => void;
}

function decompose(minutes: number): { amount: number; unit: CustomRangeUnit } {
    if (minutes >= 1440 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
    if (minutes >= 60 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
    return { amount: minutes, unit: "minutes" };
}

export function CustomRangeInput({ minutes, onChange }: CustomRangeInputProps) {
    const [{ amount, unit }, setState] = useState(() => decompose(minutes));
    const [draft, setDraft] = useState<string | null>(null);

    const commit = (nextAmount: number, nextUnit: CustomRangeUnit) => {
        setState({ amount: nextAmount, unit: nextUnit });
        onChange(customRangeToMinutes(nextAmount, nextUnit));
    };

    return (
        <div className="stats__custom-range">
            <input
                type="number"
                min={1}
                className="stats__custom-range-amount"
                value={draft ?? amount}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                onBlur={() => {
                    const parsed = draft === null ? amount : Math.max(1, Math.round(Number(draft)) || amount);
                    setDraft(null);
                    commit(parsed, unit);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
            />
            <select
                className="stats__custom-range-unit"
                value={unit}
                onChange={(e) => commit(amount, (e.target as HTMLSelectElement).value as CustomRangeUnit)}
            >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
            </select>
        </div>
    );
}
