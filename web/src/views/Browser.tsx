import { useEffect, useMemo, useState } from "preact/hooks";

import { formatNumber } from "../api/format";
import type { GridKey } from "../api/types";
import { useCpus } from "../state/cpus";
import type { CpuView } from "../state/cpus";
import type { BrowserItem } from "../state/items";
import { useItems } from "../state/items";
import { useNetwork } from "../state/network";
import { useOrder } from "../state/order";
import type { BrowserFilters } from "../state/prefs";
import { prefsKey, usePrefs } from "../state/prefs";
import { useStockRules } from "../state/stockRules";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ChipMenu, ToggleChip } from "../ui/ChipMenu";
import { cpuLedColor, cpuRank } from "../ui/CpuLeds";
import { cx } from "../ui/cx";
import { FormattedText } from "../ui/FormattedText";
import { Inspector } from "../ui/Inspector";
import { ItemIcon } from "../ui/ItemIcon";
import { StarIcon } from "../ui/icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useMeasuredColumns } from "../ui/useMeasuredColumns";
import { useVirtualWindow } from "../ui/useVirtualWindow";
import { filterItems, isLowStock, sortItems } from "./browserModel";
import type { CraftRequest } from "./ItemDetail";
import { ItemInspector } from "./ItemDetail";

export interface BrowserProps {
    /** The itemid in the inspector (the URL's `?item=`), or `null`. */
    selectedItem: string | null;
    onSelectItem: (itemid: string | null) => void;
    /** Crafting History filtered to one item (the inspector's "View all in History"). */
    onOpenHistory: (itemid: string) => void;
    onOpenCraft: (entry: { gridKey: GridKey; id: number }) => void;
    onOpenCpu: (cpu: CpuView) => void;
}

/** Matches `.item-grid`'s own `gap` (`browser.css`) - column-count math has to use the number the CSS lays out with. */
const GRID_GAP_PX = 12;
/** A card's rendered height plus one `.item-grid` row gap. */
const GRID_ROW_HEIGHT_PX = 150;
/** `.item-row`'s fixed height per density (`browser.css`). */
const LIST_ROW_HEIGHT_PX = { comfortable: 34, compact: 28 } as const;
const OVERSCAN_ROWS = 6;

const STORED_CRAFTABLE = [
    { value: 0 as const, label: "Stored only" },
    { value: 1 as const, label: "Craftable only" },
    { value: 2 as const, label: "Stored + craftable" },
];
const ITEMS_TYPE = [
    { value: 0 as const, label: "Items only" },
    { value: 1 as const, label: "Fluids only" },
    { value: 2 as const, label: "Items + fluids" },
];

export function Browser({ selectedItem, onSelectItem, onOpenHistory, onOpenCraft, onOpenCpu }: BrowserProps) {
    const { items, loading, error, failedGrids, refresh } = useItems();
    const { selected, selectedGrid } = useNetwork();
    const { isFavorite, toggleFavorite, browserFilters, setBrowserFilters, settings } = usePrefs();
    const { rules: stockRules } = useStockRules();
    const { startOrder } = useOrder();
    const [search, setSearch] = useState("");

    const isAllGrids = selected === "all";
    const hasFluids = useMemo(() => items.some((it) => it.isFluid), [items]);
    const { storedCraftable, itemsType, sortBy, sortOrder, lowStockOnly, view } = browserFilters;
    const setFilter = <K extends keyof BrowserFilters>(key: K, value: BrowserFilters[K]) =>
        setBrowserFilters((s) => ({ ...s, [key]: value }));

    const filtered = useMemo(() => {
        // When this grid has no fluids, don't let a persisted "Fluids only" silently empty the list.
        const effectiveItemsType = hasFluids ? itemsType : 2;
        let rows = filterItems(items, { storedCraftable, itemsType: effectiveItemsType, search });
        if (lowStockOnly) rows = rows.filter((it) => isLowStock(it, stockRules));
        return sortItems(rows, sortBy, sortOrder, isFavorite);
    }, [items, storedCraftable, itemsType, hasFluids, search, lowStockOnly, stockRules, sortBy, sortOrder, isFavorite]);

    const maxLog = useMemo(() => Math.log10(Math.max(10, ...items.map((it) => it.quantity))), [items]);

    // State via a callback ref, not `useRef`: the container mounts behind a loading placeholder on the first
    // render, and an effect watching a plain ref could miss it forever.
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const isList = view === "list";
    const measuredColumns = useMeasuredColumns(isList ? null : container, settings.tileMin, GRID_GAP_PX);
    const columns = isList ? 1 : measuredColumns;
    const rowHeightPx = isList ? LIST_ROW_HEIGHT_PX[settings.density] : GRID_ROW_HEIGHT_PX;
    const rowCount = Math.ceil(filtered.length / Math.max(1, columns));
    const { startRow, endRow, topSpacerPx, bottomSpacerPx } = useVirtualWindow(
        container,
        rowCount,
        rowHeightPx,
        OVERSCAN_ROWS,
    );
    const visible = filtered.slice(startRow * columns, Math.min(filtered.length, endRow * columns));

    // By itemid rather than the row object, so the inspector follows the item through a refresh.
    const detailItem =
        selectedItem === null
            ? null
            : (items.find((it) => it.itemid === selectedItem && (isAllGrids || it.sourceGridKey === selected)) ??
              items.find((it) => it.itemid === selectedItem) ??
              null);

    const craft = (item: BrowserItem, request?: CraftRequest) =>
        startOrder({
            sourceGridKey: item.sourceGridKey,
            itemid: item.itemid,
            itemname: item.itemname,
            quantity: request?.quantity,
            preferredCpu: request?.cpuKey,
        });

    // ↑/↓ walk the list; ⏎ jumps to the inspector's quantity field (⏎ there plans the craft).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            if (document.querySelector("[aria-modal='true']")) return;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
            if (e.key === "Enter") {
                const qty = document.getElementById("craft-qty") as HTMLInputElement | null;
                if (qty && detailItem) {
                    e.preventDefault();
                    qty.focus();
                    qty.select();
                }
                return;
            }
            if (filtered.length === 0) return;
            e.preventDefault();
            const at = detailItem ? filtered.findIndex((it) => it.itemid === detailItem.itemid) : -1;
            const step = (e.key === "ArrowDown" ? 1 : -1) * columns;
            const next = at < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, at + step));
            onSelectItem(filtered[next]!.itemid);
            container
                ?.closest(".page__scroll")
                ?.querySelector(`[data-index="${next}"]`)
                ?.scrollIntoView({ block: "nearest" });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [filtered, detailItem, columns, container, onSelectItem]);

    if (selected !== "all" && !selectedGrid) {
        return <div className="placeholder-panel">No network selected.</div>;
    }
    if (loading && items.length === 0) {
        return <div className="placeholder-panel">Loading items…</div>;
    }
    if (error) {
        return (
            <div className="placeholder-panel browser__error">
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void refresh()}>
                    Retry
                </Button>
            </div>
        );
    }

    const sortHeader = (label: string, by: 0 | 1 | 2, className?: string) => (
        <button
            type="button"
            className={cx("dtable__sort", sortBy === by && "dtable__sort--active", className)}
            onClick={() =>
                setBrowserFilters((s) =>
                    s.sortBy === by
                        ? { ...s, sortOrder: s.sortOrder === 0 ? 1 : 0 }
                        : { ...s, sortBy: by, sortOrder: by === 1 ? 1 : 0 },
                )
            }
        >
            {label}
            {sortBy === by ? (sortOrder === 0 ? " ↑" : " ↓") : ""}
        </button>
    );

    return (
        <div className="page page--with-dock">
            <div className="page__body">
                <div className="page__main">
                    <header className="page-header">
                        <h2 className="page-header__title">Items</h2>
                        <input
                            type="search"
                            className="field browser__filter"
                            placeholder="Filter…"
                            title="@mod filters by mod, -word excludes, >100 filters by minimum quantity"
                            value={search}
                            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                        />
                        <ChipMenu
                            options={STORED_CRAFTABLE}
                            value={storedCraftable}
                            onChange={(v) => setFilter("storedCraftable", v)}
                        />
                        {hasFluids && (
                            <ChipMenu
                                options={ITEMS_TYPE}
                                value={itemsType}
                                onChange={(v) => setFilter("itemsType", v)}
                            />
                        )}
                        <ToggleChip
                            active={lowStockOnly}
                            onChange={(v) => setFilter("lowStockOnly", v)}
                            title="Only items below their stock rule's alert level"
                        >
                            Low stock
                        </ToggleChip>
                        <div className="page-header__end">
                            <span className="mono-count">
                                {formatNumber(filtered.length)} of {formatNumber(items.length)}
                            </span>
                            <SegmentedControl
                                options={[
                                    { value: "list", label: "List" },
                                    { value: "grid", label: "Grid" },
                                ]}
                                value={view}
                                onChange={(v) => setFilter("view", v)}
                            />
                        </div>
                    </header>

                    {isAllGrids && failedGrids.length > 0 && (
                        <p className="browser__warning">{`Couldn't load items from: ${failedGrids.join(", ")}`}</p>
                    )}

                    <div className="page__scroll">
                        {filtered.length === 0 ? (
                            <div className="placeholder-panel">No items match the current filters.</div>
                        ) : isList ? (
                            <div
                                className={cx(
                                    "dtable item-list",
                                    settings.density === "compact" && "item-list--compact",
                                )}
                            >
                                <div className="dtable__head">
                                    <span />
                                    <span />
                                    {sortHeader("Item", 0)}
                                    {sortHeader("Mod", 2, "item-list__mod")}
                                    {sortHeader("Stored", 1, "right")}
                                    <span className="right">Status</span>
                                </div>
                                <div
                                    ref={setContainer}
                                    style={{ paddingTop: topSpacerPx, paddingBottom: bottomSpacerPx }}
                                >
                                    {visible.map((item, i) => {
                                        const favorited = isFavorite(prefsKey(item.sourceGridKey, item.itemid));
                                        const isSelected = detailItem === item;
                                        return (
                                            <div
                                                key={`${item.sourceGridKey}:${item.itemid}`}
                                                data-index={startRow + i}
                                                className={cx(
                                                    "dtable__row dtable__row--clickable item-row",
                                                    isSelected && "dtable__row--selected",
                                                )}
                                                onClick={() => onSelectItem(item.itemid)}
                                            >
                                                <button
                                                    type="button"
                                                    className="item-row__star"
                                                    title={favorited ? "Unfavorite" : "Favorite"}
                                                    aria-pressed={favorited}
                                                    style={{
                                                        color: favorited ? "var(--amber)" : "var(--star-inactive)",
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleFavorite(item.sourceGridKey, item.itemid);
                                                    }}
                                                >
                                                    <StarIcon size={14} />
                                                </button>
                                                <ItemIcon itemid={item.itemid} name={item.itemname} size={24} />
                                                <button
                                                    type="button"
                                                    className="cell-text item-row__name"
                                                    aria-current={isSelected || undefined}
                                                >
                                                    <FormattedText text={item.itemname} />
                                                </button>
                                                <span className="cell-sub item-list__mod">
                                                    {item.mod}
                                                    {isAllGrids ? ` · ${item.gridLabel}` : ""}
                                                </span>
                                                <div className="item-row__stored">
                                                    <div className="item-row__logbar">
                                                        <div
                                                            style={{
                                                                width: `${item.quantity > 0 ? Math.round((Math.log10(item.quantity + 1) / maxLog) * 100) : 0}%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="item-row__qty">
                                                        {formatNumber(item.quantity, settings.numberFormat)}
                                                    </span>
                                                </div>
                                                <div className="item-row__status">
                                                    {isLowStock(item, stockRules) && (
                                                        <Badge variant="red" size="sm">
                                                            Low
                                                        </Badge>
                                                    )}
                                                    {item.craftable && (
                                                        <Badge variant="teal" size="sm">
                                                            Craft
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <section
                                className="item-grid"
                                ref={setContainer}
                                style={{
                                    "--tile-min": `${settings.tileMin}px`,
                                    paddingTop: topSpacerPx + 16,
                                    paddingBottom: bottomSpacerPx + 16,
                                }}
                            >
                                {visible.map((item, i) => {
                                    const favorited = isFavorite(prefsKey(item.sourceGridKey, item.itemid));
                                    const lowStock = isLowStock(item, stockRules);
                                    return (
                                        <div
                                            key={`${item.sourceGridKey}:${item.itemid}`}
                                            data-index={startRow * columns + i}
                                            className={cx("item-card", detailItem === item && "item-card--selected")}
                                            onClick={() => onSelectItem(item.itemid)}
                                        >
                                            <button
                                                type="button"
                                                className="item-card__star"
                                                title={favorited ? "Unfavorite" : "Favorite"}
                                                aria-pressed={favorited}
                                                style={{ color: favorited ? "var(--amber)" : "var(--star-inactive)" }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleFavorite(item.sourceGridKey, item.itemid);
                                                }}
                                            >
                                                <StarIcon size={14} />
                                            </button>
                                            <button type="button" className="item-card__head">
                                                <ItemIcon itemid={item.itemid} name={item.itemname} size={40} />
                                                <div className="item-card__title">
                                                    <FormattedText text={item.itemname} className="item-card__name" />
                                                    <span className="item-card__mod">
                                                        {item.mod}
                                                        {isAllGrids ? ` · ${item.gridLabel}` : ""}
                                                    </span>
                                                </div>
                                            </button>
                                            <div className="item-card__stored">
                                                <span className="item-card__stored-value">
                                                    {formatNumber(item.quantity, settings.numberFormat)}
                                                </span>
                                                <span className="item-card__stored-label">stored</span>
                                            </div>
                                            <div className="item-card__badges">
                                                {lowStock && (
                                                    <Badge variant="red" size="sm">
                                                        Low
                                                    </Badge>
                                                )}
                                                {item.craftable && (
                                                    <Badge variant="teal" size="sm">
                                                        Craft
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </section>
                        )}
                    </div>
                </div>
                <Inspector
                    label="Item"
                    width={400}
                    open={detailItem !== null}
                    onClose={() => onSelectItem(null)}
                    placeholder="Select an item to see its stock, recent crafts and stock rule, and to craft it."
                >
                    {detailItem && (
                        <ItemInspector
                            item={detailItem}
                            onCraft={craft}
                            onOpenHistory={onOpenHistory}
                            onOpenCraft={onOpenCraft}
                        />
                    )}
                </Inspector>
            </div>
            <CraftingDock onOpen={onOpenCpu} />
        </div>
    );
}

/** The Browser's bottom strip: one cell per busy CPU, opening its Craft Detail. */
function CraftingDock({ onOpen }: { onOpen: (cpu: CpuView) => void }) {
    const { cpus } = useCpus();
    const { settings } = usePrefs();
    const busy = cpus.filter((c) => c.isBusy).sort((a, b) => cpuRank(a) - cpuRank(b));
    if (busy.length === 0) return null;
    return (
        <nav className="dock" aria-label="Crafting CPUs">
            <span className="dock__label">CRAFTING</span>
            {busy.map((cpu) => {
                const stalled = cpu.stalledSince > 0;
                const color = cpuLedColor(cpu);
                return (
                    <button
                        key={`${cpu.sourceGridKey}:${cpu.cpuKey}`}
                        type="button"
                        className="dock__cell"
                        onClick={() => onOpen(cpu)}
                    >
                        <span className="dot" style={{ background: color }} />
                        <span className="dock__cpu">{cpu.name}</span>
                        {cpu.finalOutput && (
                            <ItemIcon
                                itemid={cpu.finalOutput.itemid}
                                name={cpu.finalOutput.itemname}
                                size={20}
                                className="dock__icon"
                            />
                        )}
                        <span className="dock__item">
                            {cpu.finalOutput ? (
                                <>
                                    <FormattedText text={cpu.finalOutput.itemname} /> ×
                                    {formatNumber(cpu.finalOutput.quantity, settings.numberFormat)}
                                </>
                            ) : (
                                "Crafting"
                            )}
                        </span>
                        <span className="dock__bar">
                            <span style={{ width: `${cpu.progressPct ?? 0}%`, background: color }} />
                        </span>
                        <span className={stalled ? "dock__right red" : "dock__right"}>
                            {stalled ? "stalled" : cpu.progressPct !== null ? `${cpu.progressPct}%` : ""}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
