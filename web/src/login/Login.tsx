import { useState } from "preact/hooks";

import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { getLoginContext } from "./context";

type Banner = { kind: "error"; text: string } | { kind: "confirm-registration"; command: string } | null;

/**
 * Reads the four redirect params AE2Controller.checkAuth (native form POST -> 302, not the JSON /auth
 * API - see REDESIGN_MILESTONES.md M9 notes) can land the browser on, then scrubs the URL so a reload
 * doesn't re-show a stale banner. Ported from the old login.html's inline query-param handling.
 */
function readBanner(): Banner {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    let banner: Banner = null;
    if (params.has("notonline")) {
        banner = { kind: "error", text: "You have to be on the server (online) to perform this action." };
    } else if (params.has("invalidpassword")) {
        banner = { kind: "error", text: "Invalid password." };
    } else if (params.has("invaliduser")) {
        banner = { kind: "error", text: "Invalid username." };
    } else if (params.has("confirmregistration")) {
        const token = params.get("token") ?? "";
        banner = { kind: "confirm-registration", command: `/ae2webintegration auth ${token}` };
    }
    if (banner) {
        window.history.replaceState(null, document.title, window.location.pathname);
    }
    return banner;
}

function BrandMark() {
    return (
        <div className="sidebar__brand login-brand">
            <div className="sidebar__brand-mark" />
            <span className="sidebar__brand-name">AE2 TERMINAL</span>
        </div>
    );
}

function Banner({ banner }: { banner: Banner }) {
    const [copied, setCopied] = useState(false);
    if (!banner) return null;

    if (banner.kind === "error") {
        return (
            <div className="login-banner login-banner--error" role="alert">
                {banner.text}
            </div>
        );
    }

    const onCopy = () => {
        navigator.clipboard
            ?.writeText(banner.command)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {
                // Clipboard access can be denied (permissions, non-secure context) - the command is
                // still fully visible and selectable, so this is a convenience, not the only path.
            });
    };

    return (
        <div className="login-banner login-banner--success" role="status">
            <p>Run this command in game to finish registration:</p>
            <div className="login-banner__command">
                <code>{banner.command}</code>
                <button type="button" className="btn btn--text login-banner__copy" onClick={onCopy}>
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
        </div>
    );
}

export function Login() {
    const context = getLoginContext();
    const [banner] = useState(readBanner);
    const [mode, setMode] = useState<"signin" | "register">("signin");

    const showRegister = context.isPublicMode && mode === "register";

    // Nothing in this file talks to the server directly - both forms are native
    // method="POST" action="" submissions handled by AE2Controller.checkAuth, which answers with a
    // 302 redirect and sets the session cookie itself (HttpOnly, so JS could never do this even if it
    // wanted to). See REDESIGN_MILESTONES.md M9 notes for why this isn't a fetch() call to /auth.
    return (
        <div className="login-page">
            <div className="login-card">
                <BrandMark />
                <Banner banner={banner} />

                {context.isPublicMode && (
                    <SegmentedControl
                        className="login-mode-switch"
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: "signin", label: "Sign in" },
                            { value: "register", label: "Register" },
                        ]}
                    />
                )}

                {!showRegister ? (
                    <form className="login-form" method="POST" action="">
                        <h1 className="login-form__title">Sign in to your network</h1>
                        <label className="login-form__label" htmlFor="username">
                            Username
                        </label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            className="login-form__input"
                            placeholder="Enter username"
                            required
                            autoFocus={context.isPublicMode}
                            readOnly={!context.isPublicMode}
                            value={!context.isPublicMode ? "Admin" : undefined}
                            autoComplete="username"
                        />
                        <label className="login-form__label" htmlFor="password">
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            className="login-form__input"
                            placeholder="Enter password"
                            required
                            autoFocus={!context.isPublicMode}
                            autoComplete="current-password"
                        />
                        <label className="login-checkbox">
                            <input type="checkbox" name="remember" />
                            <span className="login-checkbox__box" />
                            Remember me for 7 days
                        </label>
                        <Button type="submit" variant="primary" className="login-form__submit">
                            Sign in
                        </Button>
                    </form>
                ) : (
                    <form className="login-form" method="POST" action="">
                        <h1 className="login-form__title">Register an account</h1>
                        <p className="login-form__hint">
                            You must be online in-game to start registration, and will need to run a command there to
                            finish it.
                        </p>
                        <label className="login-form__label" htmlFor="rusername">
                            Username (in-game)
                        </label>
                        <input
                            id="rusername"
                            name="register"
                            type="text"
                            className="login-form__input"
                            placeholder="Enter username"
                            required
                            autoFocus
                            autoComplete="off"
                        />
                        <label className="login-form__label" htmlFor="rpassword">
                            Password
                        </label>
                        <input
                            id="rpassword"
                            name="password"
                            type="password"
                            className="login-form__input"
                            placeholder="Enter password"
                            required
                            autoComplete="off"
                        />
                        <label className="login-checkbox">
                            <input type="checkbox" name="remainder" required />
                            <span className="login-checkbox__box" />I understand that the password entered above will be
                            visible to the server owner once continued.
                        </label>
                        <Button type="submit" variant="primary" className="login-form__submit">
                            Continue
                        </Button>
                    </form>
                )}
            </div>
            <footer className="login-footer">
                Hosted using{" "}
                <a href="https://github.com/kuba6000/AE2-Web-Integration" target="_blank" rel="noreferrer">
                    AE2 Web Integration
                </a>{" "}
                - made by{" "}
                <a href="https://github.com/kuba6000" target="_blank" rel="noreferrer">
                    @kuba6000
                </a>
            </footer>
        </div>
    );
}
