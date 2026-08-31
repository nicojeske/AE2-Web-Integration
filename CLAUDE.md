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

- `npm run dev` — Vite dev server against `src/dev/mock-server.ts` (fixture data, no real server needed)
- `npm run build` — `tsc --noEmit` + Vite build; **writes directly into `../src/main/resources/assets/`**
  (`webpage.html` today; `login.html` joins in M9 — see Architecture below)
- `npm run typecheck` — `tsc --noEmit` only
- `npm run format` / `npm run format:check` — Prettier over `src/**/*.{ts,tsx,css}`

**After any change under `web/src`, run `npm run build` and commit the regenerated file(s) under
`src/main/resources/assets/` in the same commit.** CI (`build-and-test.yml`, job `web-terminal`) rebuilds and
runs `git diff --exit-code` on that directory — a stale committed bundle fails the build.

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

### Web frontend (`web/`) — mid-rewrite, read `REDESIGN_MILESTONES.md` first

The frontend is being rewritten from a single ~1850-line jQuery `webpage.html` into a Preact + TypeScript +
Vite SPA, milestone by milestone. **`REDESIGN_MILESTONES.md` is the source of truth for this effort**: it
tracks which milestones are done, records real API quirks discovered along the way (e.g. no `requested`
field for craft progress — approximated from crafted totals; `GetItems` clears a global
`hashcodeToStack` map on every call; `list` carries no per-CPU progress, requiring a sequential `get` fan-in
for busy CPUs), and logs every deviation from the original design handoff. Before working on the frontend:

1. Read `REDESIGN_MILESTONES.md` in full and find the first unchecked milestone — that's the one to work.
2. Read `claude-design/README.md` and open `claude-design/AE2 Web Terminal.dc.html` (needs `support.js` and
   `image-slot.js` alongside it) for the exact target look/behavior. `claude-design/` is an **untracked
   local reference copy**, not part of any branch — if missing, it needs to be re-requested, not recreated
   from memory.
3. Read the "What the existing API actually gives us" table in `REDESIGN_MILESTONES.md` before writing data
   code — several handoff/prototype assumptions don't hold against the real Java endpoints.
4. On finishing a milestone: tick its box, set its Status/commit line, and append anything worth knowing to
   the Notes/deviations log, in the same commit as the work (or an immediate follow-up commit).

Key structural constraint: Vite's `vite-plugin-singlefile` inlines everything into one self-contained HTML
file per entry, with **no support for multiple entries** — this is why `login.html` isn't wired into the
build yet (M9) and why the build must never require `AE2Controller.WebHandler` to serve more than one static
resource per request. The emitted HTML must preserve the `_REPLACE_ME_USERNAME` / `_REPLACE_ME_IS_ADMIN` /
`_REPLACE_ME_VERSION_OUTDATED` / `_REPLACE_ME_IS_PUBLIC_MODE` placeholders verbatim — `AE2Controller.WebHandler`
substitutes them with plain string replacement, not templating.

Layout: `src/api/` (typed endpoint client, `{status,data}` envelope, `REFRESH_REQUIRED` single-retry
wrapper, formatting helpers), `src/state/` (Preact context stores — network selection, items, prefs, toasts),
`src/shell/` (sidebar/topbar/app chrome), `src/ui/` (design-system primitives), `src/views/` (per-section
panes: Browser, Jobs, History, Favorites, Statistics), `src/dev/mock-server.ts` + `src/dev/fixtures.ts`
(Vite dev-only middleware serving realistic fixture data so `npm run dev` needs no real server).

`example_website/index.php` is a customer-hosted PHP reverse proxy for people who don't want to expose the
mod's HTTP server directly. No milestone may add a new HTTP route or change the wire contract in a way that
breaks it — spot-check it still works after frontend changes that touch the API surface.

### CI

`.github/workflows/build-and-test.yml` has two independent jobs: `web-terminal` (Node 22, `npm ci`,
format check, build, then the drift check against `src/main/resources/assets`) and `build-and-test` (JDK 17,
`./gradlew build`, plus a Python unittest suite for `.github/scripts/update_core_pin.py`). Both must pass on
PRs into `core`. `test-scala-presence.yml` just greps to ensure no Scala import ever lands in `src/main/java`.
