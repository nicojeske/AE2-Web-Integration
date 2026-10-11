import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { cx } from "../ui/cx";
import { initialsOf, ItemIcon } from "../ui/ItemIcon";
import { useDialogA11y } from "../ui/useDialogA11y";
import type { CommandAction, CommandRow, CommandSources } from "./commandModel";
import { buildCommandGroups, parseCommand } from "./commandModel";

export interface CommandPaletteProps {
    sources: CommandSources;
    onRun: (action: CommandAction) => void;
    onClose: () => void;
}

/** Ctrl K: one box for items, CPUs, sections and `craft N <item>`. */
export function CommandPalette({ sources, onRun, onClose }: CommandPaletteProps) {
    const ref = useDialogA11y<HTMLDivElement>(onClose);
    const [text, setText] = useState("");
    const [cursor, setCursor] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const groups = useMemo(() => buildCommandGroups(text, sources), [text, sources]);
    const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
    const active = rows[Math.min(cursor, rows.length - 1)] ?? null;

    useEffect(() => setCursor(0), [text]);
    useEffect(() => {
        listRef.current?.querySelector(".palette__row--active")?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const run = (row: CommandRow | null, shift: boolean) => {
        if (!row) return;
        onClose();
        onRun(shift && row.shiftAction ? row.shiftAction : row.action);
    };

    const onKeyDown: JSX.KeyboardEventHandler<HTMLInputElement> = (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => (rows.length === 0 ? 0 : (c + 1) % rows.length));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => (rows.length === 0 ? 0 : (c - 1 + rows.length) % rows.length));
        } else if (e.key === "Enter") {
            e.preventDefault();
            run(active, e.shiftKey);
        } else if (e.key === "Tab" && !e.shiftKey) {
            // Fills a craft command's quantity in front of the query: `logic` -> `craft 64 logic`.
            e.preventDefault();
            const parsed = parseCommand(text);
            if (parsed.craft === null) setText(`craft 64 ${text.trim()}`);
        }
    };

    let index = -1;
    return createPortal(
        <div
            className="palette-backdrop"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div ref={ref} className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
                <div className="palette__input-row">
                    <span className="palette__prompt">›</span>
                    <input
                        className="palette__input"
                        placeholder="Search items, CPUs and sections, or craft 64 logic"
                        value={text}
                        onInput={(e) => setText((e.target as HTMLInputElement).value)}
                        onKeyDown={onKeyDown}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="palette-list"
                        aria-activedescendant={active ? `palette-${active.id}` : undefined}
                        spellcheck={false}
                        autoComplete="off"
                    />
                    <span className="palette__esc">esc</span>
                </div>
                <div className="palette__list" id="palette-list" role="listbox" ref={listRef}>
                    {groups.length === 0 && <div className="palette__empty">Nothing matches.</div>}
                    {groups.map((group) => (
                        <div key={group.label} role="group" aria-label={group.label}>
                            <div className="palette__group">{group.label}</div>
                            {group.rows.map((row) => {
                                index++;
                                const i = index;
                                return (
                                    <div
                                        key={row.id}
                                        id={`palette-${row.id}`}
                                        role="option"
                                        aria-selected={row === active}
                                        className={cx("palette__row", row === active && "palette__row--active")}
                                        onMouseMove={() => setCursor(i)}
                                        onClick={(e) => run(row, e.shiftKey)}
                                    >
                                        <RowTile row={row} />
                                        <span className="palette__label">{row.label}</span>
                                        <span className="palette__meta">{row.meta}</span>
                                        <span className="palette__hint">{row.hint}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <div className="palette__foot">
                    <span>↑↓ move</span>
                    <span>⏎ run</span>
                    <span>⇧⏎ craft</span>
                    <span>tab fill qty</span>
                    <span>@mod -word &gt;100</span>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function RowTile({ row }: { row: CommandRow }) {
    const tile = row.tile;
    if (tile?.kind === "item") return <ItemIcon itemid={tile.itemid} name={tile.itemname} size={22} />;
    if (tile?.kind === "cpu") {
        return (
            <span className="palette__cpu-tile" style={{ borderColor: tile.color }}>
                {initialsOf(tile.name)}
            </span>
        );
    }
    return <span className="palette__blank-tile" />;
}
