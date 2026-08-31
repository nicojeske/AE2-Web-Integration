import { useCallback, useMemo, useState } from "preact/hooks";

import { logout } from "./api/client";
import { getContext } from "./context";
import { ItemsProvider, useItems } from "./state/items";
import { NetworkProvider, useNetwork } from "./state/network";
import { DEFAULT_THRESHOLDS, prefsKey, PrefsProvider, usePrefs } from "./state/prefs";
import { ToastProvider, useToast } from "./state/toast";
import { OutdatedBanner } from "./shell/OutdatedBanner";
import type { Section } from "./shell/section";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { Browser } from "./views/Browser";
import { Favorites } from "./views/Favorites";
import { History } from "./views/History";
import { Jobs } from "./views/Jobs";
import { Statistics } from "./views/Statistics";

function Shell() {
    const context = getContext();
    const { refresh: refreshGrids } = useNetwork();
    const { items, refresh: refreshItems } = useItems();
    const { favorites, thresholds, notifyEnabled, setNotifyEnabled } = usePrefs();
    const toast = useToast();
    const [section, setSection] = useState<Section>("browser");
    const [search, setSearch] = useState("");

    const onToggleNotify = useCallback(() => {
        const next = !notifyEnabled;
        setNotifyEnabled(next);
        if (next && "Notification" in window && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [notifyEnabled, setNotifyEnabled]);

    const onRefresh = useCallback(async () => {
        await Promise.all([refreshGrids(), refreshItems()]);
        toast("Refreshed");
    }, [refreshGrids, refreshItems, toast]);

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
                onSectionChange={setSection}
                busyCount={0}
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
                    {section === "browser" && <Browser search={search} />}
                    {section === "jobs" && <Jobs />}
                    {section === "history" && <History />}
                    {section === "favorites" && <Favorites />}
                    {section === "stats" && <Statistics />}
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
                        <Shell />
                    </ItemsProvider>
                </NetworkProvider>
            </PrefsProvider>
        </ToastProvider>
    );
}
