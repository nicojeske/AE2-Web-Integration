import type { ComponentChildren } from "preact";
import { cx } from "./cx";
import { usePopover } from "./usePopover";

export interface ChipMenuOption<T> {
    value: T;
    label: string;
}

export interface ChipMenuProps<T> {
    options: ChipMenuOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Overrides the chip's text (otherwise the selected option's label). */
    label?: ComponentChildren;
    align?: "start" | "end";
    title?: string;
}

/** A `Label ▾` chip that opens a small option list - the console's dropdown filter. */
export function ChipMenu<T>({ options, value, onChange, label, align = "start", title }: ChipMenuProps<T>) {
    const { open, setOpen, ref } = usePopover();
    const current = options.find((o) => o.value === value);

    return (
        <div className="chip-menu" ref={ref}>
            <button
                type="button"
                className="chip"
                aria-haspopup="listbox"
                aria-expanded={open}
                title={title}
                onClick={() => setOpen((o) => !o)}
            >
                {label ?? current?.label}
                <span className="chip__caret">▾</span>
            </button>
            {open && (
                <div className={cx("chip-menu__list", align === "end" && "chip-menu__list--end")} role="listbox">
                    {options.map((o) => (
                        <button
                            key={String(o.value)}
                            type="button"
                            role="option"
                            aria-selected={o.value === value}
                            className={cx("chip-menu__option", o.value === value && "chip-menu__option--active")}
                            onClick={() => {
                                onChange(o.value);
                                setOpen(false);
                            }}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** An on/off filter chip: plain while off, accent-tinted with a `×` while on. */
export function ToggleChip({
    active,
    onChange,
    children,
    title,
}: {
    active: boolean;
    onChange: (active: boolean) => void;
    children?: ComponentChildren;
    title?: string;
}) {
    return (
        <button
            type="button"
            className={cx("chip", active && "chip--active")}
            aria-pressed={active}
            title={title}
            onClick={() => onChange(!active)}
        >
            {children}
            {active && <span aria-hidden="true">×</span>}
        </button>
    );
}
