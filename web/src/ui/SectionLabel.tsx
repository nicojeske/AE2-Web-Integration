import type { ComponentChildren } from "preact";

/** The console's mono uppercase block label, optionally with something (a link, a range picker) on its right. */
export function SectionLabel({ children, end }: { children?: ComponentChildren; end?: ComponentChildren }) {
    if (end === undefined) return <span className="section-label">{children}</span>;
    return (
        <div className="section-head">
            <span className="section-label">{children}</span>
            {end}
        </div>
    );
}
