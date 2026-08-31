import type { JSX } from "preact";

export interface IconProps {
    size?: number;
    style?: JSX.CSSProperties;
    className?: string;
}

const base = (size: number): JSX.SVGAttributes<SVGSVGElement> => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
});

export function GridIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
        </svg>
    );
}

export function CpuIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
            <rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" />
        </svg>
    );
}

export function ClockIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 7v5l4 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" />
        </svg>
    );
}

export function StarIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <path d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.7 7.1-.7z" fill="currentColor" />
        </svg>
    );
}

export function ChartIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <path
                d="M4 19V10M11 19V5M18 19V13"
                stroke="currentColor"
                stroke-width="1.8"
                fill="none"
                stroke-linecap="round"
            />
        </svg>
    );
}

export function ExpandIcon({ size = 13, style, className }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}>
            <path
                d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
