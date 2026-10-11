import { useEffect, useState } from "preact/hooks";

/** Whether `query` currently matches, following viewport changes. */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const list = window.matchMedia(query);
        const onChange = () => setMatches(list.matches);
        onChange();
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
    }, [query]);
    return matches;
}

/** The width from which a page's inspector sits inline beside its list instead of sliding over it. */
export const INLINE_INSPECTOR_QUERY = "(min-width: 1280px)";
