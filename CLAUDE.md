# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **`core` branch** of AE2 Web Integration, a Minecraft mod (Applied Energistics 2 add-on) that
exposes an AE2 network to a web browser: item browsing, crafting requests/tracking, and Discord notifications.

`core` holds almost all version-independent logic (HTTP server, web API, auth, config, crafting/tracking
logic, Discord integration, and the web frontend) but **is not a standalone mod** — it has no Minecraft/Forge
dependency at all (pure Java 8, `java-library` plugin only). Minecraft-version branches (`1.21.1`, `1.20.1`,
`1.12.2`, `1.7.10`, each a different Forge/NeoForge target) include this repo as a **git submodule** and add
only the thin adapter layer that needs Minecraft/AE2 APIs: lifecycle hooks, Mixins, and conversions between
real AE2 objects and the `core.interfaces` abstractions. Shared behavior changes belong here on `core`, not
on a version branch. Pushing to `core` triggers `.github/workflows/update-core-pins.yml`, which auto-bumps
the submodule pin on every version branch — no manual pin commit needed.

There are two independent build systems in this one repo: **Gradle** for the Java core, and **npm/Vite** for
the web frontend in `web/`, whose *build output* is committed into the Java resources tree.

## Commands

### Java core (repo root)

- `./gradlew build` — compile + run JUnit 5 tests (`useJUnitPlatform`)
- `./gradlew test` — tests only
- `./gradlew test --tests "pl.kuba6000.ae2webintegration.core.GridAccessTest"` — a single test class
- `./gradlew spotlessApply` — format Java sources (only runs when core is built as the root project; a
  version branch that includes core as a submodule uses its own spotless version instead — see the comment
  in `build.gradle`)
- `./gradlew spotlessCheck` — verify formatting without changing files

### Web frontend (`web/`)

- `npm run dev` — Vite dev server against `src/dev/mock-server.ts` (fixture data, no real server needed;
  serves both the terminal at `/` and the login page at `/login.html`)
- `npm run build` — `tsc --noEmit` + two Vite builds (terminal, then `--mode login`); **writes directly into
  `../src/main/resources/assets/`** (`webpage.html` and `login.html`) and copies `login.html` on to
  `../example_website/login.html` too — see Architecture below
- `npm run typecheck` — `tsc --noEmit` only
- `npm run format` / `npm run format:check` — Prettier over `src/**/*.{ts,tsx,css}`

**After any change under `web/src`, run `npm run build` and commit the three regenerated files
(`src/main/resources/assets/webpage.html`, `src/main/resources/assets/login.html`,
`example_website/login.html`) in the same commit.** CI (`build-and-test.yml`, job `web-terminal`) rebuilds
and runs `git diff --exit-code` on those paths — a stale committed bundle fails the build.

### Full loop against a real server

`./gradlew runServer` from the repo root (dev deps include the GTNH AE2 and AE2FluidCraft forks) starts a
real Minecraft server; the panel is then at `http://localhost:2324/`, log in as `Admin`. Needed to verify
anything touching live AE2 state, not just the mock server.

## Architecture

### Java request pipeline

`AE2Controller` owns the `HttpServer` and routes each endpoint to either a **synced** or **async** request
class, chosen by how it needs to touch AE2 state:

- **`ISyncedRequest`** (`core/ae2request/sync/`, e.g. `GetItems`, `GetCPU`, `Order`, `Job`, `CancelCPU`,
  `GetGridList`, `GetCPUList`) — needs live AE2 grid state. `AE2Controller.SyncedRequestHandler` enqueues the
  request onto a bounded queue (`AE2Controller.requests`, capacity 32) that only `CoreEngine.onServerTick()`
  drains, on the actual Minecraft server thread, inside a 5ms-per-tick drain budget
  (`CoreEngine.DRAIN_BUDGET_NANOS`). The HTTP worker thread blocks on `awaitCompletion` (10s timeout) or
  answers `SERVER_BUSY`/`TIMEOUT`/`SERVER_STOPPING`. Never add a synced request that isn't cheap enough to
  fit in that budget alongside everything else queued.
- **`IAsyncRequest`** (`core/ae2request/async/`, e.g. `GetTracking`, `GetTrackingHistory`, `GridSettings`) —
  answered directly on the HTTP worker thread. These only ever read/write stored `GridData`, never live AE2
  state, and read authorization from `GridAccessSessions` (populated by the server thread during synced
  requests) rather than checking it themselves. If a request needs live grid state, it must be synced, not
  async — this split is the reason the two hierarchies exist, don't blur it.

Both request types resolve a `grid` GET param against `GridAccessSessions`/`GridAccess` for
per-grid-per-player authorization before `handle()` runs. New endpoints get wired in
`AE2Controller.startHTTPServer()` next to the existing `createContext` calls.

Auth: session tokens (`Authorization: Bearer` or `authenticationToken` cookie) map to a `WebPrincipal` in
`validTokens`. `Config.ALLOW_NO_PASSWORD_ON_LOCALHOST` short-circuits auth for loopback callers.
`ClientAddressResolver` resolves the real client behind a trusted reverse proxy
(`X-Forwarded-For`/`X-Real-IP`), consulted consistently for both that localhost check and per-IP rate
limiting (`RateLimiter`) — never trust the raw TCP peer address alone for either.

`GridData`/`CoreData` are the persisted stores (`griddata.json`, `webdata.json`, gitignored, written next to
the running server). `AE2JobTracker` holds active-job tracking state.

### Web frontend (`web/`)

The frontend is a Preact + TypeScript + Vite SPA that replaced the old single-file jQuery `webpage.html` +
`login.html`. That rewrite (once tracked milestone-by-milestone in `REDESIGN_MILESTONES.md`, since removed)
is finished — `webpage.html` and `login.html` are both built from `web/`, and there is no active milestone
backlog. Real API quirks the rewrite ran into are worth knowing before touching data code: no `requested`
field for craft progress (approximated from crafted totals), `GetItems` clears a global `hashcodeToStack`
map on every call, and `list` carries no per-CPU progress (a sequential `get` fan-in covers busy CPUs). Read
`claude-design/README.md` and open `claude-design/AE2 Web Terminal.dc.html` (needs `support.js` and
`image-slot.js` alongside it) for the original design handoff if it's ever needed again — `claude-design/`
is an **untracked local reference copy**, not part of any branch, so it needs to be re-requested if missing.

Routing is a small hand-rolled hash router (`src/shell/route.ts`): `#/<section>[/<detail>]?grid=<selection>`.
The order/plan flow (`state/order.tsx`) is deliberately **not** addressable — it's server-side job state (a
computed-but-not-submitted plan), not a page to re-enter from a URL. The shell is responsive down to phone
width in three CSS tiers (see `app-shell.css`'s "Responsive shell" section): full sidebar >=1024px, a
76px icon rail with the network picker moved into the topbar 768–1023px, and an off-canvas Drawer-based nav
below that — `shell/NetworkPicker.tsx` is the one network-select+tracking-checkbox component both the
sidebar and the topbar render. A Settings modal (`views/SettingsModal.tsx`, gear icon in the topbar) holds
number-format/density/tile-size/auto-refresh preferences, persisted via `state/prefs.tsx`'s `settings` blob.

Key structural constraint: Vite's `vite-plugin-singlefile` inlines everything into one self-contained HTML
file per entry, with **no support for multiple entries** — this is why the build runs `vite build` twice
(`vite.config.ts` branches on `mode`) instead of one multi-input build, and why it must never require
`AE2Controller.WebHandler` to serve more than one static resource per request. The emitted `webpage.html`
must preserve the `_REPLACE_ME_USERNAME` / `_REPLACE_ME_IS_ADMIN` / `_REPLACE_ME_VERSION_OUTDATED` /
`_REPLACE_ME_IS_PUBLIC_MODE` / `_REPLACE_ME_HAS_ITEM_ICONS` placeholders verbatim (`login.html` only ever
carries `_REPLACE_ME_IS_PUBLIC_MODE`, since it's always served logged out) — `AE2Controller.WebHandler`
substitutes them with plain string replacement, not templating.

Layout: `src/api/` (typed endpoint client, `{status,data}` envelope, `REFRESH_REQUIRED` single-retry
wrapper, formatting helpers), `src/state/` (Preact context stores — network selection, items, prefs, toasts),
`src/shell/` (sidebar/topbar/app chrome, the hash router), `src/ui/` (design-system primitives), `src/views/`
(per-section panes: Browser, Jobs, History, Favorites, Statistics, Settings), `src/login/` (the separate
login page entry), `src/dev/mock-server.ts` + `src/dev/fixtures.ts` (Vite dev-only middleware serving
realistic fixture data so `npm run dev` needs no real server).

`example_website/index.php` is a customer-hosted PHP reverse proxy for people who don't want to expose the
mod's HTTP server directly. No milestone may add a new HTTP route or change the wire contract in a way that
breaks it — spot-check it still works after frontend changes that touch the API surface.

### CI

`.github/workflows/build-and-test.yml` has two independent jobs: `web-terminal` (Node 22, `npm ci`,
format check, build, then the drift check against `src/main/resources/assets`) and `build-and-test` (JDK 17,
`./gradlew build`, plus a Python unittest suite for `.github/scripts/update_core_pin.py`). Both must pass on
PRs into `core`. `test-scala-presence.yml` just greps to ensure no Scala import ever lands in `src/main/java`.
