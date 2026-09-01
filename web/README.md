# AE2 Web Terminal (frontend)

A Preact + TypeScript + Vite single-page app that replaced the old jQuery `webpage.html`/`login.html`,
built milestone-by-milestone against `../REDESIGN_MILESTONES.md`.

## Commands

- `npm run dev` — Vite dev server against `src/dev/mock-server.ts` (fixture data, no Minecraft server
  needed). Serves both entries:
  - `http://localhost:5173/` — the terminal
  - `http://localhost:5173/login.html` — the login page. Add `?publicmode=0` to see the admin-only
    variant (public mode is `true` by default in dev); redirect banners are reachable by POSTing the
    login/register forms, or by opening `?invalidpassword` / `?invaliduser` / `?notonline` /
    `?confirmregistration&token=...` directly.
- `npm run build` — `tsc --noEmit`, then two Vite builds (`vite build` for the terminal,
  `vite build --mode login` for the login page), writing directly into
  `../src/main/resources/assets/`. The login build also copies its output to
  `../example_website/login.html`, which serves an identical page through the PHP proxy's own
  `_REPLACE_ME_IS_PUBLIC_MODE` substitution.
- `npm run typecheck` — `tsc --noEmit` only.
- `npm run format` / `npm run format:check` — Prettier over `src/**/*.{ts,tsx,css}`.

### Real item icons in dev

`src/dev/mock-server.ts` also serves `/icon?name=...` and sets `_REPLACE_ME_HAS_ITEM_ICONS`, mirroring
`ItemIconIndex.java`'s display-name matching, from an `itempanel_icons/` directory expected at the repo
root (sibling of `web/`). That directory is never committed (icon copyright) - see the repo root
`CLAUDE.md` and `.gitignore` - so it's simply absent for most contributors, and the mock server falls
back to the usual generated placeholder tiles when it is.

**After any change under `src/`, run `npm run build` and commit the three regenerated files
(`src/main/resources/assets/webpage.html`, `src/main/resources/assets/login.html`,
`example_website/login.html`) in the same commit.** CI (`build-and-test.yml`, job `web-terminal`)
rebuilds and runs `git diff --exit-code` on those paths — a stale committed bundle fails the build.

## Why two builds

`vite-plugin-singlefile` inlines everything into one self-contained HTML file, but only supports a
single HTML entry per build. `AE2Controller.WebHandler` only ever serves one static resource per
request and does no bundling of its own, so each page (`webpage.html`, `login.html`) has to already be
one complete file - hence two separate `vite build` invocations sharing one `vite.config.ts` (branched
on `mode`), rather than one multi-input build.

## Placeholders

Both built pages contain tokens the Java server substitutes by literal string replace, not templating
(`AE2Controller.WebHandler`) - keep them byte-for-byte and never let Vite/Prettier/minification touch
them:

- `webpage.html`: `_REPLACE_ME_USERNAME`, `_REPLACE_ME_IS_ADMIN`, `_REPLACE_ME_VERSION_OUTDATED`,
  `_REPLACE_ME_IS_PUBLIC_MODE`, `_REPLACE_ME_HAS_ITEM_ICONS`
- `login.html`: `_REPLACE_ME_IS_PUBLIC_MODE` only - it is always served logged out, so
  `_REPLACE_ME_USERNAME`/`_REPLACE_ME_IS_ADMIN` (substituted only for an authenticated request) must
  never appear in it.

The login page's forms are plain `method="POST" action=""` submissions handled entirely by
`AE2Controller.checkAuth` (302 redirects, an `HttpOnly` session cookie set server-side) - it is
deliberately not a `fetch()` client against the JSON `/auth` API, which never sets a cookie and is used
only by `example_website/index.php`. See `REDESIGN_MILESTONES.md`'s M9 entry for the full reasoning.

## Layout

- `src/api/` - typed endpoint client, `{status,data}` envelope handling, formatting helpers
- `src/state/` - Preact context stores (network selection, items, CPUs, prefs, toasts, stats, ...)
- `src/shell/` - sidebar/topbar/app chrome for the terminal
- `src/ui/` - design-system primitives shared by the terminal and the login page
- `src/views/` - per-section panes (Browser, Jobs, History, Favorites, Statistics, ...)
- `src/login/` - the login page's own entry, component, context reader, and styles - kept separate
  from `src/main.tsx`/`src/App.tsx` since it never mounts the terminal shell
- `src/dev/` - Vite dev-only mock server + fixtures, so `npm run dev` needs no real server

See `../REDESIGN_MILESTONES.md` for the full history of decisions and deviations from the original
design handoff (`../claude-design/`, untracked, a local reference copy - re-request it if missing).
