import { useState } from "preact/hooks";

import { getCookie, setCookie } from "../util/cookies";

const SUPPRESS_COOKIE = "DoNotShowUpdateMessage";

/** Admin-only "new version available" banner, ported from the old webpage.html's showAlertIfOutdated. */
export function OutdatedBanner() {
    const [dismissed, setDismissed] = useState(() => getCookie(SUPPRESS_COOKIE) === "1");

    if (dismissed) return null;

    return (
        <div className="outdated-banner" role="status">
            <span>
                New version detected! Consider updating from{" "}
                <a href="https://github.com/kuba6000/AE2-Web-Integration/releases/" target="_blank" rel="noreferrer">
                    github
                </a>
            </span>
            <div className="outdated-banner__actions">
                <button
                    type="button"
                    className="btn btn--text"
                    style={{ color: "#101219" }}
                    onClick={() => setDismissed(true)}
                >
                    Close
                </button>
                <button
                    type="button"
                    className="btn btn--text"
                    style={{ color: "#101219" }}
                    onClick={() => {
                        setCookie(SUPPRESS_COOKIE, "1", 7);
                        setDismissed(true);
                    }}
                >
                    Hide for 7 days
                </button>
            </div>
        </div>
    );
}
