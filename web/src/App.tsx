import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { formatRelativeAge } from "./api/format";
import { logout } from "./api/client";
import { getContext } from "./context";
import { CpusProvider, useCpus } from "./state/cpus";
import { HistoryProvider, useHistory } from "./state/history";
import { ItemsProvider, useItems } from "./state/items";
import { NetworkProvider, useNetwork } from "./state/network";
import type { GridSelection } from "./state/network";
import { AutoCraftProvider } from "./state/autoCraft";
import { OrderProvider, useOrder } from "./state/order";
import { PrefsProvider, usePrefs } from "./state/prefs";
import { StatsProvider, useStats } from "./state/stats";
import { ToastProvider, useToast } from "./state/toast";
import { OutdatedBanner } from "./shell/OutdatedBanner";
import { useRoute } from "./shell/route";
import type { Section } from "./shell/section";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { cx } from "./ui/cx";
import { Browser } from "./views/Browser";
import { CraftDetail } from "./views/CraftDetail";
import { Favorites } from "./views/Favorites";
import { History } from "./views/History";
import { Jobs } from "./views/Jobs";
import { OrderModal } from "./views/OrderModal";
import { PlanDetail } from "./views/PlanDetail";
import { SettingsModal } from "./views/SettingsModal";
import { Statistics } from "./views/Statistics";
import { TrackingDetail } from "./views/TrackingDetail";
import { isLowStock } from "./views/browserModel";

function Shell() {
    const context = getContext();
    const route = useRoute();
    const { selected, selectGrid, refresh: refreshGrids } = useNetwork();
    const { items, fetchedAt, refresh: refreshItems } = useItems();
    const { busyCount, setDetailScope, refresh: refreshCpus } = useCpus();
    const { refresh: refreshHistory } = useHistory();
    const { setActive: setStatsActive, refresh: refreshStats } = useStats();
    const { favorites, thresholds, notifyEnabled, setNotifyEnabled, settings } = usePrefs();
    const order = useOrder();
    const toast = useToast();
    const [search, setSearch] = useState("");
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const section = route.section;
    const craftDetail = route.detail?.type === "cpu" ? route.detail : null;
    const historyDetail = route.detail?.type === "history" ? route.detail : null;

    const changeSection = useCallback(
        (next: Section) => {
            setMobileNavOpen(false);
            route.push({ section: next, detail: null });
        },
        [route],
    );

    // Two-way sync between the URL's `?grid=` and network selection - the URL wins on load and on
    // Back/Forward (this effect, which only reacts to `route.grid`); a manual switch (Sidebar calls
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

    // Shell is the single writer of `detailScope` - the expensive per-CPU `/get` fan-in covers every
    // busy CPU while Jobs is the active section, narrows to just the one CPU Craft Detail is showing,
    // and stops entirely everywhere else (server-thread drain budget - see CoreEngine.DRAIN_BUDGET_NANOS).
    useEffect(() => {
        if (craftDetail) {
            setDetailScope({ gridId: craftDetail.gridId, cpuName: craftDetail.cpuName });
        } else {
            setDetailScope(section === "jobs" ? "all" : null);
        }
    }, [section, craftDetail, setDetailScope]);

    // Same precedent as `detailScope` above: Statistics only polls while it's actually the visible
    // surface, not just the selected section - CraftDetail/TrackingDetail/PlanDetail can all replace
    // the section's own content regardless of `section`'s value.
    const statsVisible = section === "stats" && !craftDetail && !historyDetail && !order.flow?.previewing;
    useEffect(() => {
        setStatsActive(statsVisible);
    }, [statsVisible, setStatsActive]);

    const onToggleNotify = useCallback(() => {
        const next = !notifyEnabled;
        setNotifyEnabled(next);
        if (next && "Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [notifyEnabled, setNotifyEnabled]);

    const onRefresh = useCallback(async () => {
        await Promise.all([refreshGrids(), refreshItems(), refreshCpus(), refreshHistory(), refreshStats()]);
        toast("Refreshed");
    }, [refreshGrids, refreshItems, refreshCpus, refreshHistory, refreshStats, toast]);

    // Scoped to whatever's currently loaded (the selected grid, or every grid in All-Grids mode) -
    // not every grid regardless of selection, which would mean fetching every grid's items just to
    // feed this badge (the tracker flags server-thread cost from `items`/`get` as a risk to watch).
    const lowStockFavCount = useMemo(
        () => items.reduce((count, item) => count + (isLowStock(item, favorites, thresholds) ? 1 : 0), 0),
        [items, favorites, thresholds],
    );

    const updatedLabel = fetchedAt !== null ? `Updated ${formatRelativeAge(fetchedAt)}` : null;

    return (
        <div className={cx("app-shell", settings.density === "compact" && "app-shell--density-compact")}>
            <Sidebar
                section={section}
                onSectionChange={changeSection}
                busyCount={busyCount}
                lowStockFavCount={lowStockFavCount}
                username={context.username}
                isAdmin={context.isAdmin}
                onLogout={logout}
                mobileOpen={mobileNavOpen}
                onCloseMobile={() => setMobileNavOpen(false)}
            />
            <div className="main">
                {context.isAdmin && context.isOutdated && <OutdatedBanner />}
                <Topbar
                    section={section}
                    search={section === "browser" ? search : undefined}
                    onSearchChange={section === "browser" ? setSearch : undefined}
                    onRefresh={() => void onRefresh()}
                    onToggleNav={() => setMobileNavOpen(true)}
                    updatedLabel={updatedLabel}
                    onOpenSettings={() => setSettingsOpen(true)}
                />
                <div className="content">
                    {craftDetail ? (
                        <CraftDetail
                            gridId={craftDetail.gridId}
                            cpuName={craftDetail.cpuName}
                            onClose={() => route.push({ detail: null })}
                        />
                    ) : historyDetail ? (
                        <TrackingDetail
                            gridId={historyDetail.gridId}
                            id={historyDetail.id}
                            onClose={() => route.push({ detail: null })}
                        />
                    ) : order.flow?.previewing ? (
                        <PlanDetail onSubmitted={onOrderSubmitted} />
                    ) : (
                        <>
                            {section === "browser" && <Browser search={search} />}
                            {section === "jobs" && (
                                <Jobs
                                    onOpenCraftDetail={(cpu) =>
                                        route.push({
                                            section: "jobs",
                                            detail: { type: "cpu", gridId: cpu.sourceGridId, cpuName: cpu.name },
                                        })
                                    }
                                />
                            )}
                            {section === "history" && (
                                <History
                                    onOpen={({ gridId, id }) =>
                                        route.push({ section: "history", detail: { type: "history", gridId, id } })
                                    }
                                />
                            )}
                            {section === "favorites" && <Favorites />}
                            {section === "stats" && <Statistics />}
                        </>
                    )}
                </div>
            </div>
            <OrderModal onSubmitted={onOrderSubmitted} />
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
                    <ItemsProvider>
                        <CpusProvider>
                            <HistoryProvider>
                                <StatsProvider>
                                    {/* Outside OrderProvider on purpose - the driver must never touch
                                        useOrder()'s single UI flow slot, only the same underlying API
                                        (via craftChain.ts) headlessly. */}
                                    <AutoCraftProvider>
                                        <OrderProvider>
                                            <Shell />
                                        </OrderProvider>
                                    </AutoCraftProvider>
                                </StatsProvider>
                            </HistoryProvider>
                        </CpusProvider>
                    </ItemsProvider>
                </NetworkProvider>
            </PrefsProvider>
        </ToastProvider>
    );
}
