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

export function MenuIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                stroke-width="1.8"
                fill="none"
                stroke-linecap="round"
            />
        </svg>
    );
}

export function GearIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path
                d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.6 6.4l-1.6 1.6M8 16l-1.6 1.6M17.6 17.6L16 16M8 8 6.4 6.4"
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

/** A factory with a chimney - the GregTech Machines section. */
export function FactoryIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <path
                d="M3 20V11l5 3v-3l5 3v-3l5 3V4h3v16z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
            />
            <path d="M7 17h2M12 17h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
    );
}

export function BoltIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor" />
        </svg>
    );
}

/** A box on a conveyor - the GregTech Production section. */
export function ConveyorIcon({ size = 18, style, className }: IconProps) {
    return (
        <svg {...base(size)} style={style} className={className}>
            <rect x="8" y="4" width="8" height="8" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="3" y="14" width="18" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <circle cx="6.5" cy="16.5" r="1" fill="currentColor" />
            <circle cx="12" cy="16.5" r="1" fill="currentColor" />
            <circle cx="17.5" cy="16.5" r="1" fill="currentColor" />
        </svg>
    );
}

/** GregTech/NEI-style recipe arrow; `fill` (0..1) paints it left to right like a machine's progress. */
export function RecipeArrowIcon({ size = 22, fill = 0, style, className }: IconProps & { fill?: number }) {
    const clip = `recipe-arrow-${Math.round(Math.max(0, Math.min(1, fill)) * 1000)}`;
    const path = "M2 9.5h12V5l8 7-8 7v-4.5H2z";
    return (
        <svg {...base(size)} style={style} className={className} aria-hidden="true">
            <defs>
                <clipPath id={clip}>
                    <rect x="0" y="0" width={24 * Math.max(0, Math.min(1, fill))} height="24" />
                </clipPath>
            </defs>
            <path d={path} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            {fill > 0 && <path d={path} fill="currentColor" clip-path={`url(#${clip})`} />}
        </svg>
    );
}
