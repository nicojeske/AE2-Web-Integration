import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { logout } from "./api/client";
import { getContext } from "./context";
import { CpusProvider, useCpus } from "./state/cpus";
import { GTProvider, useFastMachinesPoll, useGT } from "./state/gt";
import { HistoryProvider, useHistory } from "./state/history";
import { ItemsProvider, useItems } from "./state/items";
import { NetworkProvider, useNetwork } from "./state/network";
import type { GridSelection } from "./state/network";
import { OrderProvider, useOrder } from "./state/order";
import { PrefsProvider, usePrefs } from "./state/prefs";
import { StatsProvider, useStats } from "./state/stats";
import { StockRulesProvider, useStockRules } from "./state/stockRules";
import { ToastProvider, useToast } from "./state/toast";
import { OutdatedBanner } from "./shell/OutdatedBanner";
import { useRoute } from "./shell/route";
import type { Section } from "./shell/section";
import { isGTSection } from "./shell/section";
import { CommandPalette } from "./shell/CommandPalette";
import type { CommandAction, CommandSources } from "./shell/commandModel";
import { GO_KEYS } from "./shell/commandModel";
import { navItems } from "./shell/nav";
import { PhoneNav } from "./shell/PhoneNav";
import { Rail } from "./shell/Rail";
import { Topbar } from "./shell/Topbar";
import { cx } from "./ui/cx";
import { Browser } from "./views/Browser";
import { CraftDetail } from "./views/CraftDetail";
import { Favorites } from "./views/Favorites";
import { History } from "./views/History";
import { Jobs } from "./views/Jobs";
import { Machines } from "./views/Machines";
import { OrderModal } from "./views/OrderModal";
import { PlanDetail } from "./views/PlanDetail";
import { Power } from "./views/Power";
import { Production } from "./views/Production";
import { SettingsModal } from "./views/SettingsModal";
import { Statistics } from "./views/Statistics";
import { isLowStock } from "./views/browserModel";

function Shell() {
    const context = getContext();
    const route = useRoute();
    const { selected, selectGrid, refresh: refreshGrids } = useNetwork();
    const { items, fetchedAt, refresh: refreshItems } = useItems();
    const { cpus, busyCount, setDetailScope, refresh: refreshCpus } = useCpus();
    const { refresh: refreshHistory, setItemFilter: setHistoryItemFilter } = useHistory();
    const { setActive: setStatsActive, refresh: refreshStats } = useStats();
    const { notifyEnabled, setNotifyEnabled, settings } = usePrefs();
    const { rules: stockRules, refresh: refreshStockRules } = useStockRules();
    const gt = useGT();
    const order = useOrder();
    const toast = useToast();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);

    // A deep link to a GT section on a server without GregTech lands on the browser instead (the
    // effect below rewrites the URL to match).
    const section = isGTSection(route.section) && !gt.enabled ? "browser" : route.section;
    const craftDetail = route.detail?.type === "cpu" ? route.detail : null;
    const historyDetail = route.detail?.type === "history" ? route.detail : null;

    // The URL's `?item=` drives Crafting History's server-side filter; other sections leave it as it was.
    useEffect(() => {
        if (section === "history") setHistoryItemFilter(route.item);
    }, [section, route.item, setHistoryItemFilter]);

    const machineDetail = route.detail?.type === "machine" ? route.detail : null;

    useEffect(() => {
        if (section !== route.section) route.replace({ section, detail: null, grid: selected });
    }, [section, route.section]);

    // `grid` re-added explicitly: a GT section's URL carries none, so leaving one would otherwise drop
    // `?grid=` from the next section's URL too (`buildHash` omits it again for GT sections).
    const changeSection = useCallback(
        (next: Section) => {
            route.push({ section: next, detail: null, grid: selected, item: null });
        },
        [route, selected],
    );

    // Two-way sync between the URL's `?grid=` and network selection - the URL wins on load and on
    // Back/Forward (this effect, which only reacts to `route.grid`); a manual switch (NetworkMenu calls
    // `selectGrid` directly via `useNetwork`, not through Shell - kept that way so it stays oblivious to
    // routing) is mirrored into the URL by the second effect below instead.
    useEffect(() => {
        if (route.grid !== null && route.grid !== selected) selectGrid(route.grid);
        // Deliberately just `route.grid` - `selectGrid` settling into `selected` must not re-run this.
    }, [route.grid, selectGrid]);

    const prevSelectedRef = useRef<GridSelection | undefined>(undefined);
    useEffect(() => {
        const prev = prevSelectedRef.current;
        prevSelectedRef.current = selected;
        order.discard(); // harmless no-op when nothing is in flight; mirrors the pre-M11 effect's shape
        if (prev === undefined) {
            // First mount: mirror the persisted selection into the URL without discarding a deep-linked
            // detail overlay - only a *real* switch (below) invalidates one of those.
            route.replace({ grid: selected });
            return;
        }
        if (prev === selected) return;
        // A real network switch invalidates any detail overlay - it's tied to the grid it was opened
        // against, and would otherwise show a stale/mismatched page under the new selection.
        route.replace({ grid: selected, detail: null });
        // Deliberately just `selected` - `route`/`order` changing identity themselves must not re-run this.
    }, [selected]);

    const onOrderSubmitted = useCallback(() => {
        changeSection("jobs");
    }, [changeSection]);

    // Shell is the single writer of `detailScope`: only the CPU Craft Detail is showing gets its expensive
    // per-CPU detail (server-thread drain budget - see CoreEngine.DRAIN_BUDGET_NANOS).
    useEffect(() => {
        setDetailScope(craftDetail ? { gridKey: craftDetail.gridKey, cpuKey: craftDetail.cpuKey } : null);
    }, [craftDetail, setDetailScope]);

    // Same precedent as `detailScope` above: Statistics only polls while it's actually the visible
    // surface, not just the selected section - CraftDetail and PlanDetail can both replace
    // the section's own content regardless of `section`'s value.
    const statsVisible = section === "stats" && !craftDetail && !order.flow?.previewing;
    useEffect(() => {
        setStatsActive(statsVisible);
    }, [statsVisible, setStatsActive]);

    // Machines polls at the scan rate while it's on screen, and only slowly (for the badge) otherwise.
    const machinesVisible = section === "machines" && !order.flow?.previewing;
    useFastMachinesPoll(machinesVisible);

    const onToggleNotify = useCallback(() => {
        const next = !notifyEnabled;
        setNotifyEnabled(next);
        if (next && "Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [notifyEnabled, setNotifyEnabled]);

    const onRefresh = useCallback(async () => {
        gt.refresh();
        await Promise.all([
            refreshGrids(),
            refreshItems(),
            refreshCpus(),
            refreshHistory(),
            refreshStats(),
            refreshStockRules(),
        ]);
        toast("Refreshed");
    }, [refreshGrids, refreshItems, refreshCpus, refreshHistory, refreshStats, refreshStockRules, gt.refresh, toast]);

    // Scoped to whatever's currently loaded (the selected grid, or every grid in All-Grids mode) -
    // not every grid regardless of selection, which would mean fetching every grid's items just to
    // feed this badge (the tracker flags server-thread cost from `items`/`get` as a risk to watch).
    const lowStockFavCount = useMemo(
        () => items.reduce((count, item) => count + (isLowStock(item, stockRules) ? 1 : 0), 0),
        [items, stockRules],
    );

    // Item-list freshness - meaningless on the GT sections, which show their own scan age instead.
    const syncedAt = isGTSection(section) ? null : fetchedAt;
    const badges = { busyCount, lowStockFavCount, gtProblemCount: gt.problemCount };
    const openJobs = useCallback(() => changeSection("jobs"), [changeSection]);

    const paletteSources: CommandSources = useMemo(
        () => ({ items, cpus, nav: navItems(gt.enabled), numberFormat: settings.numberFormat }),
        [items, cpus, gt.enabled, settings.numberFormat],
    );

    const runCommand = useCallback(
        (action: CommandAction) => {
            switch (action.type) {
                case "craft":
                    order.startOrder({
                        sourceGridKey: action.item.sourceGridKey,
                        itemid: action.item.itemid,
                        itemname: action.item.itemname,
                        quantity: action.quantity,
                        preferredCpu: action.cpuKey,
                    });
                    break;
                case "item":
                    route.push({ section: "browser", detail: null, grid: selected, item: action.item.itemid });
                    break;
                case "cpu":
                    route.push({
                        section: "jobs",
                        detail: { type: "cpu", gridKey: action.cpu.sourceGridKey, cpuKey: action.cpu.cpuKey },
                        item: null,
                    });
                    break;
                case "section":
                    changeSection(action.section);
                    break;
                case "refresh":
                    void onRefresh();
                    break;
                case "settings":
                    setSettingsOpen(true);
                    break;
            }
        },
        [order.startOrder, route, selected, changeSection, onRefresh],
    );

    // Ctrl/Cmd K or `/` opens the palette; `g` then a section letter jumps there. Typing in a field is left alone.
    const goPendingRef = useRef(0);
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((o) => !o);
                return;
            }
            const target = e.target as HTMLElement | null;
            const typing =
                target !== null &&
                (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
            if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[aria-modal='true']")) return;
            if (e.key === "/") {
                e.preventDefault();
                setPaletteOpen(true);
            } else if (e.key === "g") {
                goPendingRef.current = Date.now();
            } else if (Date.now() - goPendingRef.current < 1000) {
                goPendingRef.current = 0;
                const hit = navItems(gt.enabled).find((n) => GO_KEYS[n.section] === e.key.toLowerCase());
                if (hit) changeSection(hit.section);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [gt.enabled, changeSection]);

    return (
        <div className={cx("app-shell", settings.density === "compact" && "app-shell--density-compact")}>
            {context.isAdmin && context.isOutdated && <OutdatedBanner />}
            <Topbar
                networkDisabled={isGTSection(section)}
                itemCount={items.length}
                onOpenPalette={() => setPaletteOpen(true)}
                cpus={cpus}
                onOpenJobs={openJobs}
                syncedAt={syncedAt}
                onRefresh={() => void onRefresh()}
                username={context.username}
                isAdmin={context.isAdmin}
                onOpenSettings={() => setSettingsOpen(true)}
                onLogout={logout}
            />
            <div className="app-body">
                <Rail
                    section={section}
                    onSectionChange={changeSection}
                    hasGT={gt.enabled}
                    badges={badges}
                    onOpenSettings={() => setSettingsOpen(true)}
                />
                <div className="content">
                    {craftDetail ? (
                        <CraftDetail
                            gridKey={craftDetail.gridKey}
                            cpuKey={craftDetail.cpuKey}
                            onClose={() => route.push({ detail: null })}
                            onOpenCpu={(gridKey, cpuKey) =>
                                route.push({ section: "jobs", detail: { type: "cpu", gridKey, cpuKey } })
                            }
                        />
                    ) : order.flow?.previewing ? (
                        <PlanDetail onSubmitted={onOrderSubmitted} />
                    ) : (
                        <>
                            {section === "browser" && (
                                <Browser
                                    selectedItem={route.item}
                                    onSelectItem={(item) => route.replace({ item })}
                                    onOpenCpu={(cpu) =>
                                        route.push({
                                            section: "jobs",
                                            detail: { type: "cpu", gridKey: cpu.sourceGridKey, cpuKey: cpu.cpuKey },
                                            item: null,
                                        })
                                    }
                                    onOpenHistory={(item) =>
                                        route.push({ section: "history", detail: null, grid: selected, item })
                                    }
                                    onOpenCraft={({ gridKey, id }) =>
                                        route.push({ section: "history", detail: { type: "history", gridKey, id } })
                                    }
                                />
                            )}
                            {section === "jobs" && (
                                <Jobs
                                    onOpenCraftDetail={(cpu) =>
                                        route.push({
                                            section: "jobs",
                                            detail: { type: "cpu", gridKey: cpu.sourceGridKey, cpuKey: cpu.cpuKey },
                                        })
                                    }
                                />
                            )}
                            {section === "history" && (
                                <History
                                    open={historyDetail}
                                    onOpen={(entry) =>
                                        route.push({
                                            section: "history",
                                            detail: entry && { type: "history", gridKey: entry.gridKey, id: entry.id },
                                        })
                                    }
                                    item={route.item}
                                    onItemChange={(item) => route.push({ section: "history", detail: null, item })}
                                />
                            )}
                            {section === "favorites" && (
                                <Favorites
                                    onOpenItem={(item) =>
                                        route.push({ section: "browser", detail: null, grid: selected, item })
                                    }
                                />
                            )}
                            {section === "stats" && <Statistics />}
                            {section === "machines" && (
                                <Machines
                                    openId={machineDetail?.id ?? null}
                                    onOpen={(id) =>
                                        route.push({
                                            section: "machines",
                                            detail: id === null ? null : { type: "machine", id },
                                        })
                                    }
                                />
                            )}
                            {section === "power" && <Power />}
                            {section === "production" && (
                                <Production
                                    onOpenMachine={(id) =>
                                        route.push({ section: "machines", detail: { type: "machine", id } })
                                    }
                                    onOpenStats={() => route.push({ section: "stats", detail: null, grid: selected })}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
            <PhoneNav
                section={section}
                onSectionChange={changeSection}
                hasGT={gt.enabled}
                badges={badges}
                cpus={cpus}
                onOpenSettings={() => setSettingsOpen(true)}
                onLogout={logout}
            />
            <OrderModal onSubmitted={onOrderSubmitted} />
            {paletteOpen && (
                <CommandPalette sources={paletteSources} onRun={runCommand} onClose={() => setPaletteOpen(false)} />
            )}
            {settingsOpen && (
                <SettingsModal
                    onClose={() => setSettingsOpen(false)}
                    notifyEnabled={notifyEnabled}
                    onToggleNotify={onToggleNotify}
                />
            )}
        </div>
    );
}

export function App() {
    return (
        <ToastProvider>
            <PrefsProvider>
                <NetworkProvider>
                    <StockRulesProvider>
                        <ItemsProvider>
                            <CpusProvider>
                                <HistoryProvider>
                                    <StatsProvider>
                                        <GTProvider>
                                            <OrderProvider>
                                                <Shell />
                                            </OrderProvider>
                                        </GTProvider>
                                    </StatsProvider>
                                </HistoryProvider>
                            </CpusProvider>
                        </ItemsProvider>
                    </StockRulesProvider>
                </NetworkProvider>
            </PrefsProvider>
        </ToastProvider>
    );
}
