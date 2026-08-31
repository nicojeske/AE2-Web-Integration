import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useRef, useState } from "preact/hooks";

const TOAST_LIFETIME_MS = 3000;

interface ToastEntry {
    id: number;
    message: string;
}

const ToastContext = createContext<((message: string) => void) | null>(null);

export function ToastProvider({ children }: { children?: ComponentChildren }) {
    const [toasts, setToasts] = useState<ToastEntry[]>([]);
    const nextId = useRef(0);

    const push = useCallback((message: string) => {
        const id = nextId.current++;
        setToasts((current) => [...current, { id, message }]);
        setTimeout(() => {
            setToasts((current) => current.filter((t) => t.id !== id));
        }, TOAST_LIFETIME_MS);
    }, []);

    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className="toast-host">
                {toasts.map((t) => (
                    <div className="toast" key={t.id} role="status">
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

/** Returns a function to push a toast, auto-dismissed after 3s (bottom-right, per the design). */
export function useToast(): (message: string) => void {
    const push = useContext(ToastContext);
    if (!push) throw new Error("useToast must be used within a ToastProvider");
    return push;
}
