# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **`core` branch** of AE2 Web Integration, a Minecraft mod (Applied Energistics 2 add-on) that
exposes an AE2 network to a web browser: item browsing, crafting requests/tracking, statistics, a GregTech hub,
and Discord/ntfy notifications.

This repo is a **fork** of `kuba6000/AE2-Web-Integration` (remote `upstream`); only the `core` and `1.7.10`
branches are maintained here. Pull upstream changes with an ordinary `git merge upstream/core` (and
`upstream/1.7.10` on that branch) - the fork was ported onto upstream's architecture in 2026-10, so later
merges are incremental.

`core` holds almost all version-independent logic (HTTP server, web API, auth, config, crafting/tracking
logic, notifications, and the web frontend) but **is not a standalone mod** — it has no Minecraft/Forge
dependency at all (`java-library` plugin only). It targets Java 8 bytecode but is written with modern syntax
(records, switch expressions, `instanceof` patterns) via the Jabel javac plugin - records need `@Desugar`. It
compiles against the oldest APIs Minecraft supplies at runtime: Gson 2.2.4 and Log4j 2.0-beta9 (both
`compileOnly`; `testGson224`/`testGson280` rerun the tests on old Gson). Minecraft-version branches (`1.21.1`, `1.20.1`,
`1.12.2`, `1.7.10`, each a different Forge/NeoForge target) include this repo as a **git submodule** and add
only the thin adapter layer that needs Minecraft/AE2 APIs: lifecycle hooks, Mixins, and conversions between
real AE2 objects and the `core.interfaces` abstractions. Shared behavior changes belong here on `core`, not
on a version branch. Pushing to `core` triggers `.github/workflows/update-core-pins.yml`, which auto-bumps
the submodule pin on `1.7.10` (the only version branch the fork maintains) — no manual pin commit needed.

There are two independent build systems in this one repo: **Gradle** for the Java core, and **npm/Vite** for
the web frontend in `web/`, whose *build output* is committed into the Java resources tree.

## Commands

### Java core (repo root)

`gradlew` has no exec bit in git; run it as `sh ./gradlew ...` locally.

- `./gradlew build` — compile + run JUnit 5 tests (`useJUnitPlatform`), including the legacy-Gson reruns
- `./gradlew test` — tests only
- `./gradlew test --tests "pl.kuba6000.ae2webintegration.core.GridAccessTest"` — a single test class
- `./gradlew spotlessApply` — format Java sources (only runs when core is built as the root project; a
  version branch that includes core as a submodule uses its own spotless version instead — see the comment
  in `build.gradle`)
- `./gradlew spotlessCheck` — verify formatting without changing files
- `./gradlew generateApiDocs` — OpenAPI 3.1 description of every `/api` endpoint, built by the doclet in
  `tools/openapi-doclet` from the `@Endpoint` classes and their Javadoc (`@response`, `@pathParam`,
  `@example`...), to `build/api-docs/openapi.json`. It fails on an undocumented endpoint, query param or
  unsupported type, so new endpoints need the same Javadoc as their neighbours.
- `./gradlew -p tools/openapi-doclet test` — the doclet's own tests
- `node --test src/test/php/*.test.cjs` — the PHP proxy tests (needs `php`; `PHP_BINARY` may point at a wrapper,
  e.g. one running the `php:8.3-cli` Docker image with `--init --network host`)

### Web frontend (`web/`)

- `npm run dev` — Vite dev server against `src/dev/mock-server.ts` (fixture data, no real server needed;
  serves the terminal at `/webpage.html` and the login page at `/login.html`). The GregTech sections are on by
  default; `MOCK_GT=0` (or `?gt=0` on the page URL) simulates a server without GT, `MOCK_GT=na` (`?gt=na`) one
  whose `/api/gt/*` endpoints answer `NOT_AVAILABLE`; `MOCK_HISTORY=0` (`?history=0`) one without a history
  database (item history answers `HISTORY_DISABLED`)
- `npm run build` — `tsc --noEmit` + two Vite builds (terminal, then `--mode login`); **writes directly into
  `../src/main/resources/assets/`** (`webpage.html` and `login.html`) and copies each on to
  `../example_website/` too — see Architecture below
- `npm run typecheck` — `tsc --noEmit` only
- `npm run format` / `npm run format:check` — Prettier over `src/**/*.{ts,tsx,css}`

**After any change under `web/src`, run `npm run build` and commit the four regenerated files
(`src/main/resources/assets/webpage.html`, `src/main/resources/assets/login.html`,
`example_website/webpage.html`, `example_website/login.html`) in the same commit.** CI
(`build-and-test.yml`, job `web-terminal`) rebuilds and runs `git diff --exit-code` on those paths — a
stale committed bundle fails the build.

### Full loop against a real server

`./gradlew runServer` from the repo root (dev deps include the GTNH AE2 and AE2FluidCraft forks) starts a
real Minecraft server; the panel is then at `http://localhost:2324/`, log in as `Admin`. Needed to verify
anything touching live AE2 state, not just the mock server.

## Architecture

### Java request pipeline

Every JSON endpoint is a class annotated `@Endpoint(method, path)` under `core/http/endpoint/<category>/`,
registered in `AE2Controller.startHTTPServer()` on the one `ApiRouter` mounted at `/api`. Routes are REST-shaped:
`/api/grids/{gridKey}/items`, `.../cpus/{cpuKey}`, `.../crafting-plans/{planId}/submit`, `.../item-history`,
`/api/gt/*`, `/api/prefs`, `/api/auth/*`. Inputs bind by annotation (`RequestInputs`): `@PathParam`,
`@QueryParam` (fork addition; `@OptionalInput` makes it optional), and one `@Body` DTO of **scalar** JSON
members only. Bodies are capped at `@Endpoint.maxBodyBytes` (8 KB default; prefs raise it). Responses are
`{status, data}` envelopes with a real HTTP status per `ApiStatus`. Any non-GET request authenticated by
cookie must carry `X-AE2-Request: true` (CSRF guard) - Bearer-token clients don't. The package name decides
the OpenAPI tag (`OpenApiDoclet.CATEGORIES`).

Each endpoint picks its execution thread by its base class:

- **`ISyncedRequest`** (e.g. `GetItems`, `GetCPU`, `CreateCraftingPlan`, `SubmitCraftingPlan`, `CancelCPU`,
  `GetGrids`) — needs live AE2 grid state. It is queued on `AE2Controller.requests` (capacity 32) that only
  `CoreEngine.onServerTick()` drains, on the server thread, inside a 5ms-per-tick budget
  (`CoreEngine.DRAIN_BUDGET_NANOS`). The HTTP worker waits (10s) or answers `SERVER_BUSY`/`TIMEOUT`/
  `SERVER_STOPPING`. Never add a synced request that isn't cheap enough to fit in that budget.
- **`IAsyncRequest`** (crafting history, settings, item history, `gt/*`, prefs) — answered on
  the HTTP worker thread from stored data, never live AE2 state. A `{gridKey}` path param is resolved and
  authorized in `IAsyncRequest.init` (`GridAccess.allows`); without one (GT, prefs) the request isn't
  grid-scoped. Live state belongs in a synced request - don't blur the split.

Identities are stable `StableKey` tokens (22-char strings): grids (`GridIdentityRegistry`, persisted per world
in `<world>/ae2webintegration/grid-identities.json`), CPUs and items (`ItemIdentityRegistry`; an item without a
usable key reports `identityStatus` instead of `itemKey`). The web client treats all of them as opaque strings.
Grid permissions come from the network's own security sources (`web$getPermissions`), listed per player in
`GetGrids.accessSources`.

Auth (`auth/AuthService`): sessions map tokens (`Authorization: Bearer` or the `authenticationToken` cookie) to
a `WebPrincipal`; `general.allow_no_password_on_localhost` short-circuits loopback callers. Browser login is a
same-origin form POST to `/` handled by `http/WebHandler` (sets the cookie, redirects with `?<STATUS>` or
`?confirmregistration&token=`); `/api/auth/login` returns a Bearer token and sets no cookie. A browser clears
its session with a form POST of `clearSession=true` (`client.ts` `clearBrowserSession`), which is what the PHP
proxy needs. `ClientAddressResolver` resolves the real client behind a trusted reverse proxy for both the
localhost check and rate limiting.

Config is `config/ae2webintegration/config.toml`, owned by core (`config/Config`, NightConfig, sections in
`ConfigSettings` with `@Comment`s; `validate()` holds the bounds). Read it as `Config.INSTANCE.<section>.<field>`
- the instance is replaced whole on `/ae2webintegration reload`. Fork sections: `statistics`, `stock`, `history`,
`gregtech`. Notifications go through `notification/NotificationManager` (Discord and ntfy destinations).

Item icons can't be rendered on a headless server: a client runs `/ae2webicons export` (1.7.10 adapter), renders
every item and fluid, and uploads the PNGs over the mod's network channel to `icons/IconUpload`, which stages them
and swaps them into `config/ae2webintegration/icons/` (`Config.iconDirectory()`), one `IconFileNames`-encoded
`<itemid>.png` each. `http/IconHandler` serves them as `/icon?id=<itemid>`.

Persistence: `CoreData` (`webdata.json`: accounts, prefs blobs), per-grid settings in `GridSettingsData`
(the crafting-tracking flag) and per-grid stock rules in `StockRulesData` (itemid -> alert level, keep-stock
target, batch, auto-craft; plus which items already alerted) inside the grid-identity file, and
runtime-only `grid/GridData` (crafting plans, active job tracking - not persisted across restarts). Finished
jobs go to the history database's `ae2wi_craft_job` table (detail stored as JSONB, passed through by
`GetTracking`) when one is configured; without one they stay in `GridData` until restart.

Sampled history (`ItemHistoryStore`, `GTPowerHistoryStore`, `GTProductionLog`) lives only in PostgreSQL, via
`core/history/HistoryDb` (`history.jdbc_url`; env `AE2WEB_HISTORY_JDBC_URL`/`_DB_USER`/`_DB_PASSWORD` override
the config): hypertables with compression when TimescaleDB is installed, plain tables otherwise. There is no
JSON fallback - without a database nothing is sampled and the history endpoints answer `HISTORY_DISABLED`
(live GT state such as current power stays in memory). Item statistics sample **every** item of every usable
grid; which ones the Statistics page shows is the per-player `statsPinned` prefs entry, not server state.
Item history is keyed by grid key + `itemid`; `ae2wi_series.name` keeps each item's last-seen display name.
Item counts are stored change-only plus a per-grid `ae2wi_coverage` interval table, so "unchanged" and
"offline" stay distinguishable; an item that leaves storage gets one `0` row (known series come from
`HistoryDb.knownKeys`). Writes only enqueue for the single `HistoryWriter`
thread (never blocks a tick, retries while the DB is down); reads run on HTTP workers and degrade to no data.
Every history test uses Testcontainers and skips without Docker; `AE2WEB_SCALE_TEST=1` enables the 30k-item
`HistoryDbScaleTest`. pgjdbc is core's only extra runtime dependency: the version branch shades core with
`transitive = false`, so it must shade `org.postgresql:postgresql` explicitly (and exclude it from 1.7.10's
shadow minimization).

Stock rules (`/api/grids/{gridKey}/stock-rules[/{itemid}]`) are shared by everyone with access to the grid and
checked server-side by `stock/StockKeeper` from the tick (one grid per tick, every `stock.check_interval_seconds`):
one `StatusMessage` per dip below `alertBelow`, and auto-crafts (at most one plan computing per grid, submitted
on a later pass as requester `Auto-stock`, 5 min backoff on failure). The browser no longer auto-crafts.

`/api/prefs` (`GetPrefs`/`PutPrefs`) syncs the web terminal's favourites/browser filters/saved stats
views and pinned Statistics items across a player's devices — an opaque JSON blob (sent as the string member `blob`) per principal in
`CoreData`, keyed by `WebPrincipal.prefsKey()` (a reserved UUID for ADMIN/LOCALHOST, which have no player
identity of their own). `CoreData` never parses the blob's contents, so a frontend-only change to what it syncs
never needs a matching server change. `/icon` (`http/IconHandler`) is the one non-`/api` data route, since it
answers with a PNG.

### Web frontend (`web/`)

The frontend is a Preact + TypeScript + Vite SPA that replaced the old single-file jQuery `webpage.html` +
`login.html`. That rewrite (once tracked milestone-by-milestone in `REDESIGN_MILESTONES.md`, since removed)
is finished — `webpage.html` and `login.html` are both built from `web/`, and there is no active milestone
backlog. All server calls go through `src/api/client.ts` (relative `api/...` paths, so the panel works below a
proxy sub-path). API quirks worth knowing before touching data code: no `requested` field for craft progress
(approximated from crafted totals), and the CPU list carries no per-CPU progress (a sequential per-CPU detail
fan-in covers busy CPUs). Grids, CPUs and orderable items are addressed by their string keys; favourites,
stock rules and statistics stay keyed by `itemid`. Read
`claude-design/README.md` and open `claude-design/AE2 Web Terminal.dc.html` (needs `support.js` and
`image-slot.js` alongside it) for the original design handoff if it's ever needed again — `claude-design/`
is an **untracked local reference copy**, not part of any branch, so it needs to be re-requested if missing.

Routing is a small hand-rolled hash router (`src/shell/route.ts`): `#/<section>[/<detail>]?grid=<selection>`,
where the selection is a grid key or `all`.
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
`WebHandler` to serve more than one static resource per request. The emitted `webpage.html`
must preserve the `_REPLACE_ME_USERNAME` / `_REPLACE_ME_IS_ADMIN` / `_REPLACE_ME_VERSION_OUTDATED` /
`_REPLACE_ME_IS_PUBLIC_MODE` / `_REPLACE_ME_HAS_ITEM_ICONS` / `_REPLACE_ME_HAS_GT` placeholders verbatim
(`login.html` only ever carries `_REPLACE_ME_IS_PUBLIC_MODE`, since it's always served logged out) —
`http/WebHandler` substitutes them with plain string replacement, not templating.

Layout: `src/api/` (typed endpoint client, `{status,data}` envelope, error copy, formatting helpers), `src/state/` (Preact context stores — network selection, items, prefs, toasts),
`src/shell/` (sidebar/topbar/app chrome, the hash router), `src/ui/` (design-system primitives), `src/views/`
(per-section panes: Browser, Jobs, History, Favorites, Statistics, Settings, and the GregTech hub's Machines,
Power and Production — shown only when `hasGT`, see `docs/gt-hub/`), `src/login/` (the separate login page
entry), `src/dev/mock-server.ts` + `src/dev/fixtures.ts` + `src/dev/gtFixtures.ts` (Vite dev-only middleware
serving realistic fixture data so `npm run dev` needs no real server).

`example_website/index.php` is a customer-hosted PHP reverse proxy for people who don't want to expose the
mod's HTTP server directly. It is upstream's proxy (session cookie -> Bearer token, CSRF marker check, form
login via `/api/auth/*`, `clearSession` form) with its inline jQuery page replaced by the same
`webpage.html`/`login.html` the mod serves (copied there by `npm run build`, placeholders substituted from
cookies set at login and from `$AE2_HAS_ITEM_ICONS`/`$AE2_HAS_GT`, which have to mirror the server's config by
hand). `.htaccess` rewrites every other path to `index.php?API=<path>`; path segments may carry ids such as
`minecraft:iron_ingot:0` and are re-encoded upstream. Spot-check it (`src/test/php/proxy.test.cjs`) after
frontend changes that touch the API surface.

### CI

`.github/workflows/build-and-test.yml` has two independent jobs: `web-terminal` (Node 22, `npm ci`,
format check, build, then the drift check against `src/main/resources/assets`) and `build-and-test` (Python
unittests for `.github/scripts`, the PHP proxy tests, JDK 17 `./gradlew build`, the doclet tests and the OpenAPI
generation, uploaded as an artifact). Both must pass on PRs into `core`. `test-scala-presence.yml` just greps to
ensure no Scala import ever lands in `src/main/java`.
