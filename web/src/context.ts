export interface Ae2Context {
    username: string;
    isAdmin: boolean;
    isOutdated: boolean;
    isPublicMode: boolean;
    /** Whether AE2Controller has a non-empty ItemIconIndex - real item icons vs. placeholder tiles. */
    hasItemIcons: boolean;
}

declare global {
    interface Window {
        __AE2_CONTEXT__: Ae2Context;
    }
}

/** Read the context AE2Controller.WebHandler substitutes into webpage.html - see that file's `<script>`. */
export function getContext(): Ae2Context {
    return window.__AE2_CONTEXT__;
}
