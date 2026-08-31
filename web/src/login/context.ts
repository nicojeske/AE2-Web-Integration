export interface Ae2LoginContext {
    isPublicMode: boolean;
}

declare global {
    interface Window {
        __AE2_LOGIN__: Ae2LoginContext;
    }
}

/**
 * Reads the context AE2Controller.WebHandler substitutes into login.html - see that file's `<script>`.
 * Deliberately narrower than ../context.ts's Ae2Context: this page is only ever served logged out, so
 * username/isAdmin never exist on window.__AE2_LOGIN__.
 */
export function getLoginContext(): Ae2LoginContext {
    return window.__AE2_LOGIN__;
}
