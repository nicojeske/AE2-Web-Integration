# Phase 2: web frontend: Machines, Power, Production

Branch: `core`, directory `web/`. Prerequisite reading: `CLAUDE.md` (the "Web frontend" section, the build
and bundle-drift rule, and the placeholder rule) and [phase-1-core.md](phase-1-core.md) (the API contract).

The goal is three new sidebar sections, shown only when the server has GregTech. They should look and behave
like the existing Statistics and Favorites views and reuse their primitives. **Do not invent a new design
language.**

## 1. Plumbing

| file | change |
|---|---|
| `web/webpage.html` | add `hasGT: _REPLACE_ME_HAS_GT,` to `window.__AE2_CONTEXT__` (bare literal like the others) |
| `src/context.ts` | `hasGT: boolean` with a doc comment pointing at `GTEngine.isAvailable()` |
| `src/dev/mock-server.ts` | replace `_REPLACE_ME_HAS_GT` with `"true"` (make it switchable, e.g. env `MOCK_GT=0` → `"false"`, so the hidden state can be checked) |
| `example_website/index.php` | `$webpage = str_replace("_REPLACE_ME_HAS_GT", "false", $webpage);` next to line ~146. **Required**, or the proxied page throws a ReferenceError. `false` is honest: the proxy's generic `?API=` passthrough could forward `gt/*` GETs, but nobody has tested that, so it stays off. |
| `src/shell/section.ts` | extend `Section` with `"machines" | "power" | "production"` and add titles: "Machines", "Power", "Production" |
| `src/shell/route.ts` | add the three to `SECTIONS`. They take no `grid` param and ignore it if present. `#/machines/<id>` opens that machine's detail drawer, like `#/history/<grid>/<id>`. |
| `src/shell/Sidebar.tsx` | three `NAV_ITEMS` with new icons in `ui/icons.tsx` (gear/factory, bolt, conveyor/box). They are **filtered out when `!getContext().hasGT`**. Badge on Machines: count of loaded machines whose status is a problem (`STRUCTURE_INCOMPLETE`, `MAINTENANCE`, `NO_POWER`, `OUTPUT_FULL`, `STOPPED`), same style as the Jobs busy badge. Put a small "GregTech" group label above them if the sidebar supports groups; otherwise just append them. |
| `src/App.tsx` | route the sections to the new views. A deep link to a GT section when `!hasGT` falls back to `browser`. |
| `src/shell/NetworkPicker` / topbar | hide the network picker on GT sections, since they aren't grid-scoped. If hiding isn't easy, disable it with a tooltip. |

## 2. API layer (`src/api/types.ts`, `src/api/client.ts`)

Mirror phase-1 §5 exactly:

```ts
export type GTMachineStatus = "STRUCTURE_INCOMPLETE" | "MAINTENANCE" | "NO_POWER" | "OUTPUT_FULL"
  | "STOPPED" | "DISABLED" | "IDLE" | "RUNNING";
export const GT_STATUS_ORDER: GTMachineStatus[] = [/* same order as above */];
export const GT_PROBLEM_STATUSES = new Set<GTMachineStatus>(["STRUCTURE_INCOMPLETE","MAINTENANCE","NO_POWER","OUTPUT_FULL","STOPPED"]);

export interface GTStack { id: string; name: string; amount: number; fluid: boolean }
export interface GTMachine { id: string; dim: number; dimName: string | null; x: number; y: number; z: number;
  name: string; type: string; owner: string | null; ownerName: string | null;
  status: GTMachineStatus; statusDetail: string | null; progressTicks: number; maxProgressTicks: number;
  euPerTick: number; voltageTier: number; efficiency: number; maintenanceIssues: string[]; outputs: GTStack[];
  lastSeenMillis: number; loaded: boolean }
export interface GTMachines { scannedAt: number; scanMicros: number; unloaded: number;
  summary: Record<GTMachineStatus, number>; machines: GTMachine[] }
export interface GTPowerSource { id: string; kind: "LSC" | "WIRELESS"; name: string; owner: string | null;
  ownerName: string | null; stored: string; capacity: string | null; fill: number | null;
  avgInPerTick: number | null; avgOutPerTick: number | null; netPerTick: number | null;
  secondsToEmpty: number | null; secondsToFull: number | null;
  dim: number | null; x: number | null; y: number | null; z: number | null; sampledAt: number; loaded: boolean }
export interface GTPowerHistory { source: string; from: number; to: number; stepMillis: number;
  resolution: "fine" | "hourly"; stored: number[]; avgIn: number[]; avgOut: number[] }  // -1 = gap
export interface GTProductionEntry { key: string; name: string; fluid: boolean; total: number; perHour: number;
  breakdown: GTProductionEntry[] }
export interface GTProduction { from: number; to: number; spanMillis: number; trackingSince: number;
  resolution: "hourly" | "daily"; groupBy: "item" | "machine"; rows: GTProductionEntry[] }
export interface GTProductionHistory { stack: string | null; machine: string | null; from: number; to: number;
  stepMillis: number; resolution: "hourly" | "daily"; points: number[] }  // sums, 0 = none
export type GTRange = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "all" | "custom";
```

Client functions use plain `apiGet` (**no** `withGridRefresh`, since these aren't grid-scoped):
`getGTMachines()`, `getGTMachine(id, range)`, `getGTPower()`,
`getGTPowerHistory(source, range, points, minutes?)`, `getGTProduction(range, groupBy, machine?, minutes?)`,
`getGTProductionHistory({item?, machine?, range, points, minutes?})`. Use the existing `query()` helper.

**Number handling:** `stored` and `capacity` are decimal strings. Keep a `BigInt` (`BigInt(s)`) for exact
text and use `Number(s)` only for charts and ratios (precision loss there is fine). Add `formatEU(value:
string | number)` to `api/format.ts`. It uses the existing compact-number logic and SI suffixes
(k, M, G, T, P, E, then scientific). Add `formatEUt(n)` → `"8.5k EU/t"` and `formatDuration(seconds)` →
`"6h 12m"`, `"3d 4h"` (reuse `formatRate` and the duration helpers if a fitting one exists). Tier names:
`const GT_TIERS = ["ULV","LV","MV","HV","EV","IV","LuV","ZPM","UV","UHV","UEV","UIV","UMV","UXV","MAX"]`,
where -1 → "—".

**Error handling:** `NOT_AVAILABLE` from any GT call (the server lost its provider or config was turned off)
shows an empty state: "GregTech data isn't available on this server". It must not show an error toast.

## 3. State (`src/state/gt.tsx`)

Use a small Preact context or per-view hooks like `state/cpus.tsx`. Polling:

| data | interval | notes |
|---|---|---|
| machines | 10 s | matches the default scan interval. Also feeds the sidebar badge, so poll at app level while `hasGT`, at most every 30 s when on another section. |
| power | 10 s | only while on Power |
| production | 60 s | only while on Production or in the machine drawer |

Respect the existing Settings auto-refresh toggle (`state/prefs.tsx` → `settings`). Pause when
`document.hidden`, like the existing views.

## 4. Views

### 4.1 Machines (`src/views/Machines.tsx`, `machines.css`, `machinesModel.ts`)
- **Header strip**: KPI chips from `summary` (e.g. "12 running · 3 idle · 1 maintenance"), clickable as
  status filters. Also "N not loaded" and "scanned 4 s ago (12 µs)" from `scannedAt` and `scanMicros`.
- **Filters**: text search (name, type, `x y z`, owner), status multi-select, dimension select (distinct
  `dimName`), "show unloaded" toggle (default on). Reuse `views/browserModel.ts`'s search parsing if it fits.
  Persist the filters in the prefs blob, like browser filters.
- **Grouping**: sections in `GT_STATUS_ORDER`, problems first, with unloaded machines in a final "Not loaded"
  group (dimmed, showing "last seen 3h ago"). Each group header shows a count and collapses.
- **Card / row** (follow the Settings density and tile-size prefs like Browser): status `Badge` (colour per
  status: problems red or amber, IDLE neutral, RUNNING green, DISABLED grey), name, tier pill (`IV`),
  `ProgressBar` with `progressTicks/maxProgressTicks` and the remaining time in seconds (`ticks/20`), EU/t,
  efficiency % (`efficiency/100`), `statusDetail`, maintenance issues as small chips, current outputs with
  `ItemIcon`, and coordinates `x, y, z · dimName` (click copies `x y z`).
- **Detail drawer** (`#/machines/<id>`, `ui/Drawer`): every field above, plus `getGTMachine(id, range)` with a
  `SegmentedControl` for range (1h/24h/7d/30d). It shows a production table (item, total, /h) and a chart of
  that machine's total output over time (`getGTProductionHistory({machine:id})`, rendered with `ui/Chart`).
- Empty state when there are no machines: "No GregTech multiblocks found yet. Machines appear within one
  scan of their chunk being loaded."

### 4.2 Power (`src/views/Power.tsx`, `power.css`)
- One `Card` per source (LSC first, then wireless):
  - name, owner
  - a big **fill gauge** (`ProgressBar` or a ring) when `fill != null`
  - stored / capacity via `formatEU`
  - **net EU/t**, coloured green for positive and red for negative, with in and out underneath when present
  - **"Empty in 6h 12m"** or **"Full in 2d"**, or "Stable" when the net is 0 or null
  - a "not loaded" pill when `!loaded`
  - location for an LSC
- The card expands to a history chart (`getGTPowerHistory`) with range presets 15m/1h/6h/24h/7d/30d and a
  custom range (reuse `CustomRangeInput` and the `statsModel.RANGE_OPTIONS` pattern, but with GT ranges:
  replace `1y` with `90d`). Plot `stored` as the main line, with `avgIn`/`avgOut` as a second small chart or
  overlay. Convert `-1` to `null` gaps with `statsModel.toValues` semantics (check that helper treats -1 as a
  gap; if not, map it first).
- Wireless with `netPerTick == null` shows "rate available after the next scans".
- A top KPI row when there are several sources: total stored (sum as BigInt), total net EU/t, and the
  soonest empty.

### 4.3 Production (`src/views/Production.tsx`, `production.css`)
- Controls: range (1h/6h/24h/7d/30d/90d/custom), a **group-by toggle** (Items | Machines), and a search box.
- Table rows: icon (`ItemIcon` for items; machine rows get a generic icon), name, total, **/h**, plus a share
  bar relative to the top row. Fluids show amounts in L, and as kL/ML above 1000/10⁶.
- Expanding a row shows its `breakdown` (machines for an item, items for a machine), plus a per-item chart
  from `getGTProductionHistory({item})` showing **produced per window**. These are bars, not lines (add a
  `variant: "bars"` prop to `ui/Chart` if it lacks one, keeping the default behaviour unchanged).
- Cross-link: an item row gets a "Stock history" action that opens that `itemid` in Statistics
  (`#/stats?...`; add it to tracked items via `addTrackedItem` if the user confirms), so production can be
  compared with storage. The ids match by design (phase-1 §1, `GTStack.id`).
- Footer: "Counting since <trackingSince>" when that falls inside the range. When `spanMillis < 1h`, add a
  hint that the rates are still settling.
- Machine rows link to `#/machines/<id>`.

## 5. Mock server (`src/dev/fixtures.ts`, `src/dev/mock-server.ts`)

Add fixtures that make every state visible:
- **About 15 machines** across all 8 statuses and 2 dimensions (Overworld and "Moon"). They include an EBF
  running at IV, a Vacuum Freezer with `["Wrench","Soft Mallet"]`, a structure-incomplete Assembly Line, an
  output-full Distillation Tower with `statusDetail: "Item output full"`, a no-power Implosion Compressor,
  2 unloaded machines with `lastSeenMillis` hours ago, and one machine owned by another player (admin sees
  it).
- Progress values that advance between polls, so the progress bars visibly move.
- Power:
  - an LSC draining (net −12k EU/t, 40% full)
  - a second LSC filling
  - a wireless network with a 30-digit `stored` and `netPerTick: null` on the first poll, then a number
- History generators shaped like the existing `mockItemHistory`. Power history follows a sine wave plus
  drift. Production is hourly sums with some zero hours.
- Every route answers the real envelope. A `?fail=NOT_AVAILABLE` toggle (or env var) exercises the empty
  states.

## 6. Build and verify

1. `npm run typecheck`, `npm run format`, then `npm run build`. Commit the **four** regenerated bundles
   together with the source (CLAUDE.md rule; CI checks for drift).
2. Check in `npm run dev` at three widths (≥1024, 768–1023, phone):
   - the sidebar shows the three GT sections and the problem badge
   - with `MOCK_GT=0` they are gone, and a direct `#/machines` link falls back to the browser
   - Machines: grouping, filters, unloaded group, drawer with chart
   - Power: gauge, net colouring, empty/full countdown, history ranges, wireless null-rate text
   - Production: both groupings, breakdown, bar chart, stock-history link
   - the light and dark themes both look right
3. `example_website/index.php` replaces `_REPLACE_ME_HAS_GT`. Spot-check by grepping
   `example_website/webpage.html` for unreplaced placeholders against the PHP list.
4. `./gradlew build` still green (the bundle lives in Java resources).

## 7. Checklist / definition of done
- [x] Context flag `hasGT` end to end (webpage.html, context.ts, mock, index.php)
- [x] Types and client for all 6 endpoints, with `NOT_AVAILABLE` turned into an empty state
- [x] Sections, route, sidebar (with problem badge) and App wiring, all hidden without GT
- [x] Machines view, filters, grouping, detail drawer
- [x] Power view with gauges, countdowns and history
- [x] Production view with grouping, breakdown, bar chart and the stock-history cross-link
- [x] Fixtures covering every status and edge case
- [x] Prettier clean, typecheck clean, bundles rebuilt and committed in the same commit
- [x] Update the README phase table (Phase 2 ✅ plus commit sha)

## 8. As built (`6ea72f7`, `8980264`)

Where the code differs from the plan above:
- Files: GT fixtures live in `src/dev/gtFixtures.ts` (not `fixtures.ts`), the shared view helpers in
  `views/gtModel.ts` + `views/gtCommon.tsx` (not `machinesModel.ts`), and all three views share one
  `views/gt.css`.
- Mock toggles: `MOCK_GT=0|na`, or `?gt=0|na` on the page URL (read back off API calls' Referer), instead
  of `?fail=` on the page. `?fail=NOT_AVAILABLE` still works on a direct `/api/gt/*` request.
- Polling ignores Settings' auto-refresh: that setting is `autoRefreshItems` and only governs the
  server-thread `/items` poll. `/api/gt/*` is async (no drain budget), so GT polls like Jobs does and only
  pauses while the tab is hidden.
- `formatDuration` (ms, not seconds) gained a days tier instead of a second helper.
- Recipe progress is interpolated client-side between scans and wraps at the recipe length, so short
  recipes don't sit at 100% for most of each 10 s scan.
- Stock history: disabled in All-Grids mode (Statistics is per-network). For an untracked item it asks
  inline ("Track & open"), since tracking uses one of the network's limited slots.
- Phone width: the Production row actions move into the expanded row.
- The terminal has no light theme, so "both themes" only applies to dark.
- Power (`628048f`, after the phase): the main LSC (the largest by capacity, or one pinned with "Set as
  main", stored in synced prefs as `mainPowerSource`) gets a full-width panel with its stored and net
  charts always shown. The other sources keep the cards with a History toggle, and the totals row only
  appears when there is no LSC. Rates read as amps at the highest tier reached plus raw EU/t
  (`formatEUtTier`, e.g. "+3.7A IV · 30k EU/t"). Chart axes stay in EU/t.

- Passive machines (after the phase): machines that always run the same recipe or the same few can be
  marked passive, from the drawer or from a suggestion strip above the groups. The marks are stored in
  synced prefs as `passiveMachines` (`id -> true` means passive, `false` means a dismissed suggestion).
  While Running or Idle, a marked machine sits in a "Passive" group after the status groups, collapsed on
  every visit. Any other status puts it back in its normal group. The server's `/api/gt/machines` lists
  `suggestedPassive`, built by `core/gt/GTPassiveDetector`: production is tracked for 1-3 days (capped at
  the hourly retention), that span is cut into 3 equal windows of whole hourly buckets, and a machine is
  suggested when its set of output stacks is non-empty and the same in all three windows. It reads through
  `GTProductionLog.totals`, so both history backends give the same answer, and it is cached for 10 minutes.
