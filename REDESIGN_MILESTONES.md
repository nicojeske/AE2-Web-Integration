# AE2 Web Terminal Redesign — Milestone Tracker

## How to resume

1. `git checkout core && git pull` inside the `core` submodule/checkout.
2. Read this whole file, then find the **first unchecked milestone** below — work only that one.
3. Read `claude-design/README.md` (design tokens, screen specs, interactions, state shape) and open
   `claude-design/AE2 Web Terminal.dc.html` in a browser (needs `support.js` and `image-slot.js`
   alongside it) for the exact prototype look and behavior. `claude-design/` sits in the working tree of
   the `1.7.10` checkout, untracked by git — it is a local reference copy, not part of any branch. If it
   is missing, ask the user for the handoff bundle before starting.
4. Read the "What the existing API actually gives us" section below before touching any data code —
   several handoff/prototype assumptions do not hold against the real Java endpoints.
5. Do the milestone's work, verify it (see **Verification**, every milestone), then **tick its box, set
   its Status line, and append anything worth knowing to the Notes / deviations log** — in the same
   commit as the work, or an immediate follow-up commit. A milestone is not finished until this file
   says so.
6. Commit on the `core` branch. Pushing triggers `core/.github/workflows/update-core-pins.yml`, which
   bumps the submodule pin on the version branches automatically — no manual pin commit needed.

## Context

A high-fidelity design handoff (`claude-design/`) replaces the whole web terminal: a five-section
single-page app (Item Browser, Active Jobs, Crafting History, Favorites, Statistics) plus a full-page
craft detail view, an order modal, compare/tracked-items modals, a detail drawer and toasts. Today's
terminal is `src/main/resources/assets/webpage.html` — ~1850 lines of inline jQuery
string-concatenation UI against the existing JSON endpoints.

The redesign is split into ten milestones, each sized for one Claude Code session and ending in a commit
here. Every milestone leaves the terminal in a working, demonstrable state.

**Decisions already made (do not re-litigate):**

| Topic | Decision |
| --- | --- |
| Stack | Preact + TypeScript + Vite in a new `core/web/` directory |
| Output | Vite inlines JS+CSS into a single self-contained `webpage.html` / `login.html` (`vite-plugin-singlefile`) — **no `AE2Controller` change, `example_website/index.php` untouched** |
| Build wiring | Built HTML is committed to `src/main/resources/assets/`; core CI rebuilds and fails on drift. Version-branch builds stay pure Java (no Node) |
| Item icons | Generated placeholder tiles (deterministic colour + initials from `itemid`); no icon endpoint |
| Statistics data | New internal server-side sampler + fixed-resolution ring buffer + endpoint. No external TSDB |
| Kept from old UI | Tracking-detail charts (re-drawn as SVG in the new language), outdated-version banner, login page restyled to the new tokens |
| Dropped from old UI | Number-format / items-per-row / show-item-ID / auto-refresh settings (polling is always on; numbers use fixed mono formatting per the design) |

One deviation worth stating up front: the **"Enable tracking for this grid" checkbox is kept** (in the
sidebar network block). `gridsettings?track=` is the only way to switch tracking on anywhere in the
mod, and tracking gates the craft-detail progress UI, the bottleneck panel and the whole Crafting
History section — dropping the toggle would make those unreachable.

## What the existing API actually gives us

| Endpoint | Shape | Notes |
| --- | --- | --- |
| `grids` | `[{key, cpuCount, owner, isOwned, isTrackingEnabled}]` | `key == -1` = non-attachable, admin-only, render disabled |
| `items?grid=` | `[{hashcode, itemid, itemname, quantity, craftable}]` | **Clears the global `AE2Controller.hashcodeToStack` on every call** |
| `list?grid=` | map `cpuName -> {isBusy, finalOutput, availableStorage, usedStorage, coProcessors, hasTrackingInfo, timeStarted}` | **No progress figure** |
| `get?grid=&cpu=` | `{size, isBusy, finalOutput, hasTrackingInfo, timeStarted, timeElapsed, items[]}` | `items[]` = `JSON_CompactedItem`: `active, pending, stored, craftedTotal, timeSpentCrafting, shareInCraftingTime, shareInCraftingTimeCombined, craftsPerSec` |
| `order?grid=&item=<hashcode>&quantity=` | `{jobID}` | Denies `ALL_CPU_BUSY` when every CPU is busy — so merge-into-busy is impossible when *all* are busy |
| `job?grid=&id=` | `{isDone, isSimulating, bytesTotal, plan[{itemid,itemname,stored,requested,missing,steps,usedPercent}]}` | Poll until `isDone`; `&cancel` discards, `&submit&cpu=` submits |
| `cancelcpu?grid=&cpu=` | — | `CPU_NOT_BUSY` when idle |
| `trackinghistory?grid=` / `gettracking?grid=&id=` / `gridsettings?grid=&track=` | async | Can answer `REFRESH_REQUIRED`; retry once after re-fetching `grids` (port the existing `getJSONWithGridRefresh` logic, old `webpage.html:1125`) |

Consequences to honour everywhere:

1. **No `requested` per item.** Progress is approximated: `requested ≈ craftedTotal + active + pending`
   per item, sub-craft progress `= Σ craftedTotal / Σ requested`. This matches the design's own caption
   ("approximated from crafted totals"). Do not add a Java field for it in these milestones.
2. **Jobs-card progress needs `get` per busy CPU.** `list` carries none. Poll `list`, then fetch `get`
   for busy CPUs *sequentially* (these run as server-thread tasks — do not fan out unbounded).
3. **`hashcodeToStack` is global and cleared per `items` call.** Before `order`, always re-fetch
   `items?grid=<target grid>` so the hashcode is live. Critical in All-Grids mode.
4. **Real byte cost is only known after the plan is computed.** The prototype's `qty * 4096` rule is a
   mock. Real flow: `order` → poll `job?id=` → validate CPUs against the returned `bytesTotal`
   (reuse the rule in old `webpage.html:1161` `isValidCPUForOrder`) → `job&submit&cpu=`.
5. **Simulated plans (`isSimulating`) are not submittable** — today's UI hides Start for them. Show the
   Missing column and a clear notice; use the design's "Start anyway" label only for plans the server
   will actually accept.
6. **All-Grids mode is client fan-out**: one request per grid, results tagged with `sourceGridId` /
   `gridLabel`. Rate limiting only applies pre-login, so this is safe, but keep concurrency modest.

---

## Milestones

### - [x] M0 — Tracker, build pipeline, design system, app shell
**Status:** Done — 34444a6e6b6d7d6558f9c286de534dac9c351095

- This file, committed before any code.
- `core/web/`: `package.json`, `tsconfig.json`, `vite.config.ts` (two entries → `webpage.html`,
  `login.html`; `vite-plugin-singlefile`; output written into `../src/main/resources/assets/`),
  prettier config. Preserve the `_REPLACE_ME_USERNAME` / `_REPLACE_ME_IS_ADMIN` /
  `_REPLACE_ME_VERSION_OUTDATED` / `_REPLACE_ME_IS_PUBLIC_MODE` placeholders verbatim in the emitted
  HTML — `AE2Controller.WebHandler` (`AE2Controller.java:1026-1042`) substitutes them by string replace.
- `src/styles/tokens.css`: every colour/typography/spacing/radius token from the handoff table as CSS
  custom properties. Google Fonts link with system fallbacks.
- `src/ui/`: primitives — `Button`, `Badge`/`StatusPill`, `Card`, `ProgressBar`, `SegmentedControl`,
  `FilterPill`, `Checkbox`, `Toast` (3s auto-dismiss, bottom-right), `Modal` (backdrop click closes,
  inner click stops propagation, plus focus trap and Escape), `Drawer`, `ItemIcon` (deterministic
  placeholder tile), `Icon` set (grid, cpu, clock, star, chart, expand).
- `src/api/`: typed client for every endpoint above; `{status, data}` envelope handling;
  `REFRESH_REQUIRED` single-retry wrapper; ported helpers from old `webpage.html` —
  `parseSpecialFormat`/`skipSpecialFormat` (§-codes), `formatBytes`, `formatTime`, `formatPercent`, a
  fixed number formatter.
- `src/dev/mock-server.ts`: Vite dev middleware serving fixtures in the real shapes (busy/idle CPUs,
  tracked and untracked grids, a simulating plan, history entries).
- App shell: sidebar (brand, network `<select>` from `grids` incl. All Grids and disabled `key == -1`
  entries, owner/CPU meta line, nav with count pills, footer with notify checkbox, avatar, username,
  `?logout` link), topbar, outdated-version banner for admins (cookie-suppressed for 7 days), toast
  host. Nav switches between placeholder panes.
- `core/.github/workflows/build-and-test.yml`: add Node setup, `npm ci`, `npm run build`,
  `git diff --exit-code` drift check, prettier check. `core/.gitignore`: `web/node_modules`.
- `spotless` untouched (targets `src/**/*.java` only).

**Done when** `npm run build` produces the two committed HTML files, the shell renders against the mock
server and against a real server, network selection persists (localStorage — restores the old "default
grid" behaviour), and core CI is green.

### - [x] M1 — Item Browser
**Status:** Done — 29d6d58246482a1522ad1e685fe740f25c82b4c1

- Filter pills (stored/craftable, items/fluids, sort A-Z/# stored/mod, asc/desc — cycling on click as
  today), `{n} of {m} shown`, search input in the topbar, `auto-fill minmax(220px,1fr)` card grid.
- Item cards: icon, name (§-formatted), mod sub-line (`+ " - " + gridLabel` in All-Grids), mono stored
  count, Low stock / Craftable + Craft button / Not craftable badge row, absolute star toggle.
  Favourited items sort to the top regardless of active sort.
- `src/state/prefs.ts`: localStorage-persisted `favorites`, `thresholds`
  (`alertBelow 100, keepStock 200, batchSize 64, autoCraft false`), `notifyEnabled`, keyed
  `"<gridId>:<itemId>"`. Used by M6 too.
- All-Grids fan-out for `items`; grid tracking checkbox in the sidebar network block
  (`gridsettings?grid=&track=`, with the REFRESH_REQUIRED retry).
- Refresh button → re-fetch + "Refreshed" toast.
- The Craft button opens the order modal, which lands in M4 — wire it to a no-op/stub here.

**Done when** browsing, searching, filtering, sorting and favouriting work on a real grid and in
All-Grids mode, and low-stock badges reflect stored thresholds.

### - [x] M2 — Active Jobs, detail drawer, live polling, completion notifications
**Status:** Done — dd5082ff3ea4bb67679a3cbc1b7ca9b5689ed4e4

- `src/state/poller.ts`: single polling loop (`list` per selected grid, then sequential `get` for busy
  CPUs), pause when `document.hidden`, cancel on unmount.
- CPU cards: name + Busy/Idle pill, `Crafting {item} x{qty}` / "No active job", 6px progress bar
  (approximation rule above; hidden when `!hasTrackingInfo`), mono footer `{n} co-procs` /
  `{used} / {total}` bytes.
- Busy card → craft detail (M3, stub for now); idle card → detail drawer listing the CPU's items.
  Busy-CPU drawer gets the red "Cancel Job" footer (`cancelcpu`, with confirm).
- Job completion detection from the poll (busy CPU with a known output goes idle) → "Completed" toast,
  and a `Notification` when the sidebar checkbox is enabled, permission is granted and `document.hidden`.
  Permission is requested on first enable.
- Sidebar green busy-count pill goes live.

**Done when** jobs appear, tick, and complete against a real server; cancelling from the drawer works;
notifications fire only under the three conditions.

### - [ ] M3 — Craft detail, active mode
**Status:** Not started

- Header (back button, `{item} x{qty}`, subtitle, status pill), stat strip (Output, Elapsed/Took,
  Est. remaining — `~{time}` once progress ≥15% and elapsed >20s else "Calculating", Crafts/sec from
  `craftsPerSec`), 8px progress bar with `width .4s ease` and the sub-craft caption.
- Three columns (Crafting/amber, Waiting/grey, Done/green) from the `get` item split
  (`active > 0` / `pending > 0` / neither), per-card stats plus crafted `x / y`, rate, time spent and
  the 4px purple share bar (`shareInCraftingTimeCombined`) when tracking is on; dashed empty states.
- "Where the time went" collapsible — top 5 by `timeSpentCrafting`, 190px name / amber bar /
  `{duration} - {pct}%`.
- `hasTrackingInfo == false` gating: no progress bar, no crafted/rate/time stats, no bottleneck panel,
  status reads "Crafting - no tracking".
- Actions: red-tinted "Cancel job" (+ "Back to jobs" once finished). 1s re-render tick so elapsed counts
  up.

**Done when** a real tracked job renders correctly end to end, an untracked job degrades exactly as
specified, and cancel returns to Jobs.

### - [ ] M4 — Order modal and plan-mode craft detail
**Status:** Not started

- Order modal (480px): item header, quantity stepper (`-512 -64 -1`, mono input, `+1 +64 +512`).
- Real flow: re-fetch `items?grid=` for the hashcode → `order` → poll `job?id=` with a
  "Calculating" state → CPU list validated against the returned `bytesTotal` using the existing rule
  (idle: `availableStorage >= bytesTotal`; busy: same output and
  `availableStorage >= usedStorage + bytesTotal`), rendering the three states (idle/mergeable/invalid
  with `cursor:not-allowed`) → footer Cancel / Preview plan / Start Crafting (disabled until a valid
  CPU is picked) → `job&submit&cpu=` → navigate to Active Jobs + toast. Cancel/close discards via
  `job&cancel`.
- Plan-mode craft detail off the same page: stat strip (Output, Bytes, Craft steps, Missing items),
  Missing/To craft/From storage columns from `plan[]`, teal share bar from `usedPercent`,
  "Discard plan" + "Start Crafting"/"Start anyway".
- Surface `ALL_CPU_BUSY` and `FAIL` denials as readable errors rather than silent failure.

**Done when** a craft can be ordered, previewed and submitted on a real server, and an unsubmittable
simulated plan is clearly explained instead of offering a dead button.

### - [ ] M5 — Crafting History and tracking detail
**Status:** Not started

- History rows from `trackinghistory` (`{name} x{qty}` over timestamp, mono duration,
  Completed/Cancelled pill), clicking opens the detail.
- Detail from `gettracking`: per-item cards (`craftedTotal`, time spent, share, crafts/sec) plus the
  two charts kept from the old UI, re-drawn as hand-rolled SVG timelines in the new design language:
  item-share and interface-share (`timings[]` start/end pairs, interface locations in the tooltip).
  Chart.js and jQuery are gone for good after this milestone.

**Done when** history lists and opens, both timelines render, and the old Chart.js/jQuery CDN tags no
longer exist anywhere in the built page.

### - [ ] M6 — Favorites and auto-craft
**Status:** Not started

- One wrapping row per favourite: name + `{grid} - {n} stored`, three 80px number inputs (Alert below,
  Keep stock at, Batch size), Auto-craft checkbox, Low stock/OK pill, Craft button, 28px remove.
  Dashed empty state with the specified copy.
- Auto-craft driver on the poll tick: for each favourite with `autoCraft` and `stored < keepStock`,
  start `min(batchSize, keepStock - stored)` through the real order→plan→submit chain on the first
  valid CPU, skipping items already being crafted; toast each start. Needs a guard against re-entry and
  against retry storms when a plan keeps simulating.
- Sidebar red low-stock pill goes live.

**Done when** thresholds persist, low-stock states agree with the Browser badges, and auto-craft starts
exactly one job per item per cycle against a real server.

### - [ ] M7 — Statistics: server-side history store (Java)
**Status:** Not started

- `core/.../tracking/ItemHistoryStore.java` (or similar): per-grid tracked-item set + fixed-resolution
  ring buffer of stored counts. Suggested defaults: one sample per 5 minutes, 30 days retention
  (8640 points/item), hard cap on tracked items per grid; persisted next to the existing
  `griddata.json` (follow `GridData`/`CoreData` conventions).
- Sampling hooked into the existing server-thread tick pump (see `CoreEngine` tick handling), reading
  the storage list only for tracked keys.
- New endpoints: history read (`grid`, item ids, range) returning bucketed series, and tracked-set
  read/write — the tracked set must live server-side because sampling does. Follow the
  `ISyncedRequest`/`IAsyncRequest` patterns and register in `AE2Controller.startHTTPServer` next to the
  existing contexts.
- JUnit tests in `core/src/test/...` alongside the existing suites: ring-buffer wraparound, retention,
  bucketing, persistence round-trip, tracked-set cap.
- The design's "All time" range maps to full retention — label it honestly.

**Done when** `./gradlew build` in `core/` is green with new tests, and the endpoints return sane
series for a running server.

### - [ ] M8 — Statistics: client
**Status:** Not started

- Range segmented control (default 7d), "Manage tracked items" modal (420px, search, 16px checkboxes,
  Done) writing the server-side tracked set.
- Chart cards (`minmax(300px,1fr)`): name, mono 19px current value, delta pill, expand button,
  `240×70` `preserveAspectRatio="none"` sparkline (purple 2px line, `rgba(139,123,245,0.14)` area),
  hover dot + tooltip at `translate(-50%,-130%)`, hover index `round(x / width * (count-1))` clamped,
  footer start label / "now".
- Compare modal (760px, max 92vw): range control, add-item input with ≤8-match dropdown, legend chips,
  `680×260` multi-line SVG (2.5px strokes, the six-colour palette), vertical `#343c60` hover line,
  normalisation caption, fixed-height raw-value readout. Saved views persisted in localStorage.
- Empty state with the specified copy.

**Done when** a grid with tracked items graphs real sampled history, compare normalises correctly, and
saved views survive a reload.

### - [ ] M9 — Login page, docs, final pass
**Status:** Not started

- Rebuild `login.html` on the new tokens (the handoff has no login design — derive from the design
  system), preserving the public-mode registration flow, the `/auth` POST contract, the
  `_REPLACE_ME_IS_PUBLIC_MODE` placeholder and the `?confirmregistration` path.
- Sweep: keyboard/focus behaviour on every modal and the drawer, `prefers-reduced-motion`, error/empty
  states, no leftover dead code from the old page, bundle size sanity check.
- Update `core/README.md` (features list, gallery note) and add `core/web/README.md` documenting
  `npm run dev` / `npm run build` and the committed-output rule.

**Done when** login, session expiry, logout and registration all work on a real server and the docs
describe the new build.

---

## Verification (every milestone)

1. `cd core/web && npm run dev` — the mock server covers all shapes including tracked/untracked and
   simulating plans; check both the states the design specifies and their degraded forms.
2. `cd core/web && npm run build` — then confirm `git status` shows the regenerated
   `src/main/resources/assets/*.html` (committed output is the contract).
3. `cd core && ./gradlew build` — Java tests, required for M7 and any milestone touching Java.
4. Real server: from the repo root `./gradlew runServer` (dev deps already include the GTNH AE2 and
   AE2FluidCraft forks), then open `http://localhost:2324/`, log in as Admin, and exercise the
   milestone's screens against a real network. Needed at least for M1-M6 and M9; a single-player
   network with two CPUs and one tracked grid covers most paths.
5. This file updated — box ticked, status and commit sha set, deviations logged.
6. Custom-website path stays intact: nothing in these milestones may add a new HTTP route, so
   `example_website/index.php` must keep working unchanged — spot-check once (M0) and again at M9.

## Risks to watch

- **Server-thread cost.** `get` and `items` run as synced tasks on the Minecraft server thread. Polling
  intervals and the busy-CPU `get` fan-in must stay conservative (M2 sets the pattern; later milestones
  must not multiply it).
- **All-Grids amplification.** N grids × (items + list + per-CPU get) is the worst case. Cap
  concurrency and consider polling only the visible section's data.
- **Bundle drift.** The committed HTML is the artifact; forgetting `npm run build` before committing is
  the most likely CI failure. The drift check in M0 exists for exactly that.
- **Progress approximation.** Derived from crafted totals; it can move non-monotonically. Clamp to
  `[0, 100]` and never let it read 100% before the CPU actually goes idle.

## Notes / deviations

_(newest last)_

- **M0**: Node.js/npm were not installed on the dev machine; installed via `sudo pacman -S nodejs npm`
  (Node v26.7.0, npm 12.0.2) before scaffolding `core/web/`.
- **M0**: TypeScript pinned to `^7.0.2` (the current stable release, the native/"tsgo" compiler), not the
  5.x line - it was the `latest` dist-tag at the time and Vite 8 / `@preact/preset-vite` both declare
  support for it.
- **M0**: `login.html` is intentionally **not** wired into the Vite build yet.
  `vite-plugin-singlefile` only supports one HTML entry per build (multiple entries are a documented
  `wontfix`), so `webpage.html` alone is built for now and the old `login.html` keeps being served
  untouched. M9 gives it its own single-entry build when it rebuilds the page.
- **M0**: The server has no human-readable grid name - `GetGridList.java`'s `JSON_GridData` only carries
  `key` (numeric), `owner`, and `cpuCount`, unlike the design's mocked `label` field. The network
  `<select>` labels grids by owner, falling back to `"{owner} - #{key}"` only when one owner has more
  than one grid (see `src/shell/gridLabel.ts`).
- **M0**: The old UI's "select this grid by default" checkbox was **not** reintroduced (it wasn't in the
  approved parity list). Instead, whichever grid is currently selected is transparently persisted to
  `localStorage` and restored on next load - same practical effect (the terminal reopens where you left
  it), no extra UI.
- **M0**: `formatTime`, the old webpage.html's single-unit duration formatter, was not ported - the new
  design's copy (`"4m 12s"`, `"1h 03m"`) needs combined units, so `src/api/format.ts` exports
  `formatDuration` instead, matching the prototype's own `fmtDur` helper.
- **Risk discovered, not fixed (frontend milestone, Java out of scope)**: `GetCPU.java` computes
  `craftsPerSec = craftedTotal / (timeSpentCrafting / 1000d)` unconditionally once `hasTrackingInfo` is
  true. Immediately after a job starts tracking, both operands can be `0`, giving Java's `0.0/0.0 = NaN`.
  Gson's default (non-lenient) `Gson` instance throws `IllegalArgumentException` writing `NaN`/`Infinity`
  doubles, which would make `/get` fail entirely for a CPU in that state. `GSONUtils.GSON_BUILDER` does
  not call `.serializeSpecialFloatingPointValues()`. Whichever milestone first renders `craftsPerSec`
  (M3) should watch for this in real testing; the real fix is a small Java change (guard the division, or
  make the builder lenient) that belongs on its own, separately reviewed.
- **M1**: Removed the stale nested `core/` submodule worktree (a leftover `1.7.10`-checkout artifact -
  `core` is only a real submodule on the version branches, not on `core`). All paths this file calls
  `core/web/…` are therefore just `web/…` at the repo root from here on.
- **M1**: `GetItems.java` synthesises craft-only rows via `web$stackOf(craftable, 0)`, so the real
  payload contains `quantity: 0` craftable items - the prototype's "Stored only" (`craftable === false`)
  would hide every craftable item actually in stock. Reimplemented as `quantity > 0` / `craftable` /
  both, confirmed with the user.
- **M1**: No server field distinguishes fluids from items, and `web$getItemID()` differs per version
  branch (1.7.10/1.12.2: colon-free for native fluids; 1.20.1/1.21.1: same `namespace:path` shape as
  items, indistinguishable). Classified client-side in `src/views/browserModel.ts` (`isFluidId`: no
  colon, or an `ae2fc:fluid_drop*` prefix) and the Items/Fluids toolbar pill only renders when the
  current list actually contains a fluid - so it simply doesn't appear on 1.20.1/1.21.1 rather than
  being a dead control that can empty the grid.
- **M1**: All-Grids `items` fan-out (`src/state/items.tsx`) is sequential, not concurrent -
  `GetItems.handle` clears a single global static `hashcodeToStack` map on every call, and the synced
  request queue is a 32-slot `ArrayBlockingQueue` that answers `SERVER_BUSY` on overflow. Per-grid
  failures are collected into `failedGrids` and surfaced as a dim warning line instead of blanking the
  whole browser.
- **M1**: Added `src/state/prefs.tsx` (favorites/thresholds/notifyEnabled/browserFilters, all
  localStorage-persisted, keyed on `itemid` never `hashcode` - `hashcode` is a transient ordering token
  a global map wipes on every `items` call) and `src/state/items.tsx` (the shared `items` fetch/fan-out
  store). Both are `.tsx` rather than the originally sketched `prefs.ts`/`items.ts`, since `prefs.tsx`
  renders a provider and `items.tsx` needs JSX for the same reason. The four browser filter/sort
  selections are persisted too (legacy `webpage.html` cookie-persisted them for 7 days; not on the
  "Dropped from old UI" list).
- **M1**: Kept the "Enable tracking for this grid" sidebar checkbox scoped to a single real grid
  (hidden in All-Grids mode and for the disabled `key === -1` admin-only entry) - `gridsettings` is
  per-grid and denies `GRID_NOT_FOUND` for `-1`.
- **M1**: The sidebar's red low-stock-favorites count pill is scoped to whatever is currently loaded
  (the selected grid, or every grid in All-Grids mode), not every grid regardless of selection like the
  prototype. Fetching every grid's items just to feed a sidebar badge would run against this file's own
  "server-thread cost" risk; the badge simply agrees with the Item Browser's own low-stock badges.
- **M1**: Search matches the §-stripped item name (`plainName`, always up to date; the legacy
  `webpage.html` matched the raw §-coded name, so a query spanning a colour code could never match) or
  the raw `itemid` (the legacy UI never searched it).
- **M1**: `.item-icon` border-radius corrected from `--radius-sm` (6px, M0) to `--radius-md` (8px) -
  the design specifies radius 8 for the item tile (`radius="8"` on the prototype's `image-slot`).
- **M1**: Refresh now awaits both the grid-list and items refetches before toasting "Refreshed" (the
  prototype toasts immediately, before any data exists).
- **M1**: Extended the mock fixtures (`src/dev/fixtures.ts`) to ~18 items across 6 mods in grid 1,
  including two `quantity: 0, craftable: true` rows, two rows under the default `alertBelow` (100), one
  colon-free native-fluid id alongside the existing `ae2fc:fluid_drop:*` row, and removed grid 2's only
  fluid so switching networks demonstrates the Items/Fluids pill appearing and disappearing.
- **M1 verified**: `npm run dev` against the mock server with a headless Chromium (Playwright,
  downloaded for this session only - no browser automation tool was otherwise available) confirmed all
  four toolbar pills cycle correctly, the `{n} of {m}` count, search, every sort × order, favorites
  pinning to the top, low-stock/craftable/not-craftable badge combinations, the sidebar low-stock pill,
  the fluids pill appearing/disappearing per grid, All-Grids fan-out counts (hand-verified against the
  fixture data), the tracking checkbox's full round trip against the mock `gridsettings` endpoint, and
  the Craft stub toast - with zero console/page errors. Not yet exercised against a real Forge server
  (`./gradlew runServer`) - do that before relying on this milestone in-game.
- **M2**: `CpuDetail.items` retyped `CompactedItem[] | null` - `GetCPU.java` skips its whole busy block
  for an idle CPU, so real responses come back `null` (`GSON_BUILDER` serializes nulls), never `[]`. The
  mock server's idle `/get` branch was also corrected from `[]` to `null` to match.
- **M2**: New `src/state/cpus.tsx` (`CpusProvider`/`useCpus`, not the tracker's originally sketched
  `poller.ts` - it renders a provider, so needs JSX, mirroring `items.tsx`). Polling is **tiered**:
  `/list` runs on every section (drives the sidebar busy pill and completion toasts/notifications
  everywhere), while the per-busy-CPU `/get` fan-in (needed for progress bars and drawer item lists)
  only runs while the Jobs view is mounted, via a `detailPolling` flag Jobs flips on/off. Neither the
  tiering nor the cadence (2.5s single grid, 5s All-Grids, both paused on `document.hidden`) is in the
  design - both follow directly from `/list`/`/get` being server-thread tasks under `CoreEngine`'s
  5ms/tick drain budget and the 32-slot `AE2Controller.requests` queue.
- **M2**: Completion detection does **not** treat a CPU name that disappeared from `/list` as finished.
  `GetCPUList.java`'s `internalID` (and therefore a CPU's default `"CPU #n"` name) is reassigned on
  every enumeration of the crafting-CPU set, so adding/removing a cluster can silently renumber the
  others - a vanished key is a renumber, not a completion. A completion only fires for a key still
  present in the new list but now idle.
- **M2**: A failed `/get` (thrown `ApiError` or a dropped connection) is swallowed and retried next
  cycle rather than surfacing as a view error - `GetCPU.java`'s unguarded `craftedTotal /
  timeSpentCrafting` division can produce a `NaN`/`Infinity` right after a job starts, and
  `GSONUtils.GSON_BUILDER` isn't lenient, so the whole HTTP response is dropped server-side (no error
  envelope at all) rather than answering a clean denial. This is the risk logged in the Notes below
  under M0; M2 is the first milestone that can actually hit it.
- **M2**: No progress bar for a busy CPU with `hasTrackingInfo: false`. The design's prototype always
  shows one, but its `progressPct` there is a pure client-side mock with no server-side source; the
  real approximation (`Σcraftedtotal / Σ(craftedTotal+active+pending)`, clamped to `[0, 99]` so it can
  never read 100% before the CPU actually goes idle) needs the tracking fields `/get` only populates
  when tracking was on when the job started.
- **M2**: `usedStorage === -1` (the normal "not reported" value on modern AE2's `web$getUsedStorage()`
  mixin, and 1.7.10 when the accessor is absent) renders as `— / {total}` in both the CPU card footer
  and the drawer's Storage stat, instead of the design's literal `-1 B`.
- **M2**: Co-processor counts are pluralised (`1 co-proc` / `6 co-procs`); the prototype always prints
  "co-procs" even for one.
- **M2**: Both busy and idle CPU cards open the detail drawer (the milestone bullet reads "busy card →
  craft detail (M3, stub for now); idle card → detail drawer", but M3's craft-detail page doesn't exist
  yet, and the milestone's own "cancelling from the drawer works" acceptance criterion is otherwise
  unreachable, since idle CPUs have nothing to cancel). The busy-CPU drawer carries a "View craft
  detail →" link that shows the M3 stub toast (matching M1's Craft-button stub convention), plus the
  red "Cancel Job" footer the design specifies for a busy CPU's drawer.
- **M2**: Cancelling asks for confirmation via a `Modal` stacked on the drawer (the milestone spec asks
  for a confirm; the design prototype cancels immediately with no confirmation at all).
  `useDialogA11y`/`Drawer` gained an `enabled`/`trapFocus` flag so the drawer's own focus trap suspends
  while the modal is open - defensive, since both dialogs portal to `document.body` as siblings and
  don't actually contend for focus, but cheap and reusable by M4's order modal.
- **M2**: The idle-CPU drawer gained a stats block (Status, Co-processors, Storage) plus a dashed
  "No items on this CPU" empty state, instead of the design's bare (and, for a real idle CPU, always
  empty) item list.
- **M2**: In All-Grids mode a CPU card shows the source grid's label under the CPU name (reusing
  `gridOptionLabel`); the design shows only the raw CPU name, which collides across grids since
  `GetCPUList.java` reassigns `"CPU #n"` names independently per grid.
- **M2**: `Button`'s prop type was widened from `JSX.HTMLAttributes<HTMLButtonElement>` to
  `JSX.ButtonHTMLAttributes<HTMLButtonElement>` - preact's generic `HTMLAttributes` doesn't carry
  `disabled` (it lives on the element-specific interface), so the cancel-in-flight disabled state
  needed here didn't type-check against the existing primitive.
- **M2**: Dev fixtures gained a second busy CPU on grid 1 (`Fluix Cluster`, untracked, `usedStorage:
  -1`) and a busy CPU on grid 2 (`Foundry CPU`, short `craftDurationMs` so completion is observable in
  seconds). The mock server had no mechanism at all to transition a busy CPU to idle when its mocked
  `craftDurationMs` elapsed (only `/cancelcpu` moved a CPU between the two lists) - added
  `settleCompletedJobs()`, called at the top of every mock request, so completion detection is actually
  exercisable under `npm run dev`.
- **M2 verified**: `npm run dev` against the mock server with headless Chromium (Playwright, same setup
  as M1) confirmed: CPU cards render correctly for busy/idle/untracked-busy/`usedStorage:-1` states; the
  sidebar busy pill is live and scoped to the current selection; the idle drawer shows the stats block
  and empty state with no Cancel footer; the busy drawer shows real per-item crafting/scheduled/stored
  numbers immediately on open; cancelling asks for confirmation, Escape on the confirm modal closes only
  the modal (the drawer stays open), and confirming actually cancels, toasts, and updates the card on
  the next poll; a short-duration mock job completing produces exactly one "finished crafting" toast and
  flips its card to Idle; All-Grids mode fans across both grids with grid-label sub-lines; and polling
  measurably stops while `document.hidden` and resumes immediately on becoming visible again - all with
  zero console/page errors (one benign browser-chrome `favicon.ico` 404, confirmed unrelated to any
  application request). **Not yet exercised against a real Forge server** (`./gradlew runServer`) - in
  particular the `craftsPerSec` NaN/dropped-response path (only reachable with real AE2 tracking
  timing) and real `cancelcpu`/CPU-renumbering behavior need in-game verification before relying on this
  milestone. Desktop `Notification` permission/gating was code-reviewed against the four-gate rule but
  not exercised live (headless Chromium has no interactive permission prompt to grant).
