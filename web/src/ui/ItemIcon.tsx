import { skipSpecialFormat } from "../api/format";

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
 * No AE2 item textures are available on a headless server (see REDESIGN_MILESTONES.md decisions), so
 * every item/fluid gets a stable generated tile instead: a hue derived from `itemid` plus initials from
 * its display name. Same item always renders the same tile.
 */
export function ItemIcon({ itemid, name, size = 44, className }: ItemIconProps) {
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
            title={skipSpecialFormat(name)}
            aria-hidden="true"
        >
            {initialsOf(name)}
        </div>
    );
}
