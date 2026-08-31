import { useCallback, useState } from "preact/hooks";

import { logout } from "./api/client";
import { getContext } from "./context";
import { NetworkProvider, useNetwork } from "./state/network";
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

const NOTIFY_STORAGE_KEY = "ae2.notifyEnabled";

function readNotifyEnabled(): boolean {
    return localStorage.getItem(NOTIFY_STORAGE_KEY) === "1";
}

function Shell() {
    const context = getContext();
    const { refresh } = useNetwork();
    const toast = useToast();
    const [section, setSection] = useState<Section>("browser");
    const [search, setSearch] = useState("");
    const [notifyEnabled, setNotifyEnabled] = useState(readNotifyEnabled);

    const onToggleNotify = useCallback(() => {
        setNotifyEnabled((enabled) => {
            const next = !enabled;
            localStorage.setItem(NOTIFY_STORAGE_KEY, next ? "1" : "0");
            if (next && "Notification" in window && Notification.permission === "default") {
                void Notification.requestPermission();
            }
            return next;
        });
    }, []);

    const onRefresh = useCallback(() => {
        void refresh();
        toast("Refreshed");
    }, [refresh, toast]);

    return (
        <div className="app-shell">
            <Sidebar
                section={section}
                onSectionChange={setSection}
                busyCount={0}
                lowStockFavCount={0}
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
                    onRefresh={onRefresh}
                />
                <div className="content">
                    {section === "browser" && <Browser />}
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
            <NetworkProvider>
                <Shell />
            </NetworkProvider>
        </ToastProvider>
    );
}
