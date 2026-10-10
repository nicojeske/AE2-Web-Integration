// Per-grid stock rules (alert level, keep-stock target, auto-craft). They live on the server, which checks
// them every `stock.check_interval_seconds` with no browser open - auto-crafting what's below its target and
// sending a Discord/ntfy alert when something drops below its alert level. This store only edits them and
// shows the server's last check. Rules are shared by everyone with access to a grid; favourites stay per
// player (`state/prefs.tsx`).
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { deleteStockRule, getStockRules, putStockRule } from "../api/client";
import { describeApiError } from "../api/errors";
import type { GridKey, StockRule, StockRuleInput } from "../api/types";
import { useNetwork } from "./network";
import { prefsKey } from "./prefs";
import { useToast } from "./toast";

/** What "Add stock rule" starts from. */
export const DEFAULT_STOCK_RULE: StockRuleInput = {
    alertBelow: 100,
    keepStock: 200,
    batchSize: 64,
    autoCraft: false,
};

/** The server checks every 30s by default; polling faster than that shows nothing new. */
const POLL_MS = 30_000;

export interface StockRulesContextValue {
    /** By `prefsKey(gridKey, itemid)`, for every grid in the current selection. */
    rules: Record<string, StockRule>;
    setRule: (gridKey: GridKey, itemid: string, rule: StockRuleInput) => Promise<void>;
    removeRule: (gridKey: GridKey, itemid: string) => Promise<void>;
    refresh: () => Promise<void>;
}

const StockRulesContext = createContext<StockRulesContextValue | null>(null);

/** A rule the server hasn't checked yet: the edit is applied before its PUT answers. */
function unchecked(itemid: string, input: StockRuleInput): StockRule {
    return {
        ...input,
        itemid,
        stored: -1,
        low: false,
        crafting: false,
        lastAttempt: 0,
        lastError: null,
        backoffUntil: 0,
    };
}

export function StockRulesProvider({ children }: { children?: ComponentChildren }) {
    const { grids, selected, selectedGrid } = useNetwork();
    const toast = useToast();
    const [rules, setRules] = useState<Record<string, StockRule>>({});

    const refresh = useCallback(async () => {
        const targets = selected === "all" ? grids : selectedGrid ? [selectedGrid] : [];
        // Async endpoints (stored data, not the server tick), so fanning out is fine.
        const pages = await Promise.all(
            targets.map(async (grid) => {
                try {
                    return { gridKey: grid.key, rows: await getStockRules(grid.key) };
                } catch {
                    return { gridKey: grid.key, rows: [] as StockRule[] };
                }
            }),
        );
        const next: Record<string, StockRule> = {};
        for (const { gridKey, rows } of pages) {
            for (const rule of rows) next[prefsKey(gridKey, rule.itemid)] = rule;
        }
        setRules(next);
    }, [grids, selected, selectedGrid]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        const timer = setInterval(() => {
            if (!document.hidden) void refreshRef.current();
        }, POLL_MS);
        return () => clearInterval(timer);
    }, []);

    const setRule = useCallback(
        async (gridKey: GridKey, itemid: string, input: StockRuleInput) => {
            const key = prefsKey(gridKey, itemid);
            setRules((current) => ({
                ...current,
                [key]: current[key] ? { ...current[key], ...input } : unchecked(itemid, input),
            }));
            try {
                const stored = await putStockRule(gridKey, itemid, input);
                setRules((current) => ({ ...current, [key]: stored }));
            } catch (e) {
                toast(describeApiError(e, "Could not save the stock rule"));
                void refreshRef.current();
            }
        },
        [toast],
    );

    const removeRule = useCallback(
        async (gridKey: GridKey, itemid: string) => {
            const key = prefsKey(gridKey, itemid);
            setRules((current) => {
                const next = { ...current };
                delete next[key];
                return next;
            });
            try {
                await deleteStockRule(gridKey, itemid);
            } catch (e) {
                toast(describeApiError(e, "Could not delete the stock rule"));
                void refreshRef.current();
            }
        },
        [toast],
    );

    const value = useMemo<StockRulesContextValue>(
        () => ({ rules, setRule, removeRule, refresh }),
        [rules, setRule, removeRule, refresh],
    );
    return <StockRulesContext.Provider value={value}>{children}</StockRulesContext.Provider>;
}

export function useStockRules(): StockRulesContextValue {
    const ctx = useContext(StockRulesContext);
    if (!ctx) throw new Error("useStockRules must be used within a StockRulesProvider");
    return ctx;
}
