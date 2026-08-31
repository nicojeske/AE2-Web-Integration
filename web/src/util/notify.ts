/**
 * Desktop notification on job completion - fires only when all four gates from the design prototype
 * hold: the user has opted in, the Notification API exists, permission is granted, and the tab isn't
 * focused (the toast already covers the focused case). Permission itself is requested lazily on first
 * enabling the sidebar checkbox (see App.tsx's onToggleNotify), not here.
 */
export function notify(enabled: boolean, title: string, body: string): void {
    if (!enabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return;
    try {
        new Notification(title, { body });
    } catch {
        // Some browser/embedding contexts throw constructing a Notification directly (e.g. requiring
        // a service worker) - nothing to recover, the toast already covered this event.
    }
}
