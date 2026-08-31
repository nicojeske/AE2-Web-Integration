import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { logout } from "./api/client";
import { getContext } from "./context";
import { CpusProvider, useCpus } from "./state/cpus";
import { ItemsProvider, useItems } from "./state/items";
import { NetworkProvider, useNetwork } from "./state/network";
import { DEFAULT_THRESHOLDS, prefsKey, PrefsProvider, usePrefs } from "./state/prefs";
import { ToastProvider, useToast } from "./state/toast";
import { OutdatedBanner } from "./shell/OutdatedBanner";
import type { Section } from "./shell/section";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { Browser } from "./views/Browser";
import { CraftDetail } from "./views/CraftDetail";
import { Favorites } from "./views/Favorites";
import { History } from "./views/History";
import { Jobs } from "./views/Jobs";
import { Statistics } from "./views/Statistics";

function Shell() {
    const context = getContext();
    const { selected, refresh: refreshGrids } = useNetwork();
    const { items, refresh: refreshItems } = useItems();
    const { busyCount, setDetailScope, refresh: refreshCpus } = useCpus();
    const { favorites, thresholds, notifyEnabled, setNotifyEnabled } = usePrefs();
    const toast = useToast();
    const [section, setSection] = useState<Section>("browser");
    const [search, setSearch] = useState("");
    const [craftDetail, setCraftDetail] = useState<{ gridId: number; cpuName: string } | null>(null);

    const changeSection = useCallback((next: Section) => {
        setCraftDetail(null);
        setSection(next);
    }, []);

    // A grid switch can leave `craftDetail` pointing at a CPU that no longer means anything in the
    // new selection (a different grid entirely, in single-grid mode) - close it rather than showing a
    // stale/mismatched page. Sidebar drives grid selection directly via `useNetwork` (not through
    // Shell), so this has to watch `selected` rather than wrap a handler the way `changeSection` does.
    useEffect(() => {
        setCraftDetail(null);
    }, [selected]);

    // Shell is the single writer of `detailScope` - the expensive per-CPU `/get` fan-in covers every
    // busy CPU while Jobs is the active section, narrows to just the one CPU Craft Detail is showing,
    // and stops entirely everywhere else (server-thread drain budget, see REDESIGN_MILESTONES.md caveat 2).
    useEffect(() => {
        if (craftDetail) {
            setDetailScope({ gridId: craftDetail.gridId, cpuName: craftDetail.cpuName });
        } else {
            setDetailScope(section === "jobs" ? "all" : null);
        }
    }, [section, craftDetail, setDetailScope]);

    const onToggleNotify = useCallback(() => {
        const next = !notifyEnabled;
        setNotifyEnabled(next);
        if (next && "Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [notifyEnabled, setNotifyEnabled]);

    const onRefresh = useCallback(async () => {
        await Promise.all([refreshGrids(), refreshItems(), refreshCpus()]);
        toast("Refreshed");
    }, [refreshGrids, refreshItems, refreshCpus, toast]);

    // Scoped to whatever's currently loaded (the selected grid, or every grid in All-Grids mode) -
    // not every grid regardless of selection, which would mean fetching every grid's items just to
    // feed this badge (the tracker flags server-thread cost from `items`/`get` as a risk to watch).
    const lowStockFavCount = useMemo(() => {
        let count = 0;
        for (const item of items) {
            const key = prefsKey(item.sourceGridId, item.itemid);
            if (!favorites[key]) continue;
            const alertBelow = thresholds[key]?.alertBelow ?? DEFAULT_THRESHOLDS.alertBelow;
            if (item.quantity < alertBelow) count++;
        }
        return count;
    }, [items, favorites, thresholds]);

    return (
        <div className="app-shell">
            <Sidebar
                section={section}
                onSectionChange={changeSection}
                busyCount={busyCount}
                lowStockFavCount={lowStockFavCount}
                notifyEnabled={notifyEnabled}
                onToggleNotify={onToggleNotify}
                username={context.username}
                isAdmin={context.isAdmin}
                onLogout={logout}
            />
            <div className="main">
                {context.isAdmin && context.isOutdated && <OutdatedBanner />}
                <Topbar
                    section={section}
                    search={section === "browser" ? search : undefined}
                    onSearchChange={section === "browser" ? setSearch : undefined}
                    onRefresh={() => void onRefresh()}
                />
                <div className="content">
                    {craftDetail ? (
                        <CraftDetail
                            gridId={craftDetail.gridId}
                            cpuName={craftDetail.cpuName}
                            onClose={() => setCraftDetail(null)}
                        />
                    ) : (
                        <>
                            {section === "browser" && <Browser search={search} />}
                            {section === "jobs" && (
                                <Jobs
                                    onOpenCraftDetail={(cpu) =>
                                        setCraftDetail({ gridId: cpu.sourceGridId, cpuName: cpu.name })
                                    }
                                />
                            )}
                            {section === "history" && <History />}
                            {section === "favorites" && <Favorites />}
                            {section === "stats" && <Statistics />}
                        </>
                    )}
                </div>
            </div>
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
                            <Shell />
                        </CpusProvider>
                    </ItemsProvider>
                </NetworkProvider>
            </PrefsProvider>
        </ToastProvider>
    );
}
