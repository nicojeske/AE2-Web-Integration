import { useState } from "preact/hooks";

import { iconUrl } from "../api/client";
import { skipSpecialFormat } from "../api/format";
import { getContext } from "../context";

export interface ItemIconProps {
    itemid: string;
    name: string;
    size?: number;
    className?: string;
}

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function initialsOf(name: string): string {
    const plain = skipSpecialFormat(name).trim();
    const words = plain.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Names that have already 404'd against `icon?name=...` this page load. Shared across every mount so
 * scrolling a list or reopening a modal never refires a request already known to miss - see
 * REDESIGN_MILESTONES.md's "try + fallback" decision. Only cleared by a full page reload; the icon
 * directory can't change without a server restart or `/reload` either.
 */
const missingIcons = new Set<string>();

/**
 * Renders a real item icon, matched server-side by display name (AE2Controller's ItemIconIndex), when
 * the server has one configured and this item's name has a match. Falls back to a generated placeholder
 * tile otherwise - a hue derived from `itemid` plus initials from the display name - which covers both
 * "no icon export configured" and "item not in the export" the same way, via the `<img>`'s `onError`.
 */
export function ItemIcon({ itemid, name, size = 44, className }: ItemIconProps) {
    const plain = skipSpecialFormat(name).trim();
    const [failed, setFailed] = useState(() => missingIcons.has(plain));

    if (getContext().hasItemIcons && !failed && plain.length > 0) {
        return (
            <img
                className={`item-icon item-icon--image${className ? ` ${className}` : ""}`}
                style={{ width: `${size}px`, height: `${size}px` }}
                src={iconUrl(plain)}
                alt=""
                title={plain}
                loading="lazy"
                decoding="async"
                aria-hidden="true"
                onError={() => {
                    missingIcons.add(plain);
                    setFailed(true);
                }}
            />
        );
    }

    const hue = hashString(itemid) % 360;
    return (
        <div
            className={`item-icon${className ? ` ${className}` : ""}`}
            style={{
                width: `${size}px`,
                height: `${size}px`,
                fontSize: `${Math.round(size * 0.34)}px`,
                background: `hsl(${hue}, 45%, 30%)`,
                border: `1px solid hsl(${hue}, 45%, 42%)`,
            }}
            title={plain}
            aria-hidden="true"
        >
            {initialsOf(name)}
        </div>
    );
}
