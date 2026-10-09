# Phase 1: core (as built). **This is the contract.**

Branch: `core`. Commits: `db97705` (implementation and tests), `db584c0` (rate-span floor). Pure Java 8 with
no Minecraft or GregTech imports. Phases 2 and 3 code against what is described here. If you change any of
it, change it here too.

## 1. Adapter-facing API (`core/api/gt/`, `core/api/IAEWebInterface`)

```java
// Registered once at mod init by a branch that has GregTech.
IAEWebInterface.getInstance().registerGTProvider(IGTProvider provider);

// From the recipe-output hook, on the server thread, once per output stack. Must stay cheap.
IAEWebInterface.getInstance().recordGTProduction(String machineId, String machineName, UUID owner,
    String stackId, String stackName, long amount, boolean fluid);

// Optional: when a controller is broken, so it disappears now instead of after gregtech.machine_forget_days.
IAEWebInterface.getInstance().gtMachineRemoved(String machineId);

public interface IGTProvider {
    /** Server thread, from the tick, every gregtech.scan_interval_seconds. Never return null. */
    GTScanResult scan(long nowMillis);
}
```

`GTScanResult` (all collections non-null):

| field | meaning |
|---|---|
| `List<GTMachineSnapshot> machines` | every **loaded** multiblock controller |
| `List<GTPowerSourceSnapshot> powerSources` | loaded LSCs plus one wireless network per team that has machines |
| `Map<UUID,UUID> teams` | player → GT team leader, for every owner seen and every online player. Core **merges** it. |
| `Map<UUID,String> playerNames` | optional; currently unused by core, reserved |

`GTMachineSnapshot`, filled by the provider (field names are also the JSON names):

| field | type | notes |
|---|---|---|
| `id` | String | `GTMachineSnapshot.idOf(dim,x,y,z)` → `"0:120:64:-340"` |
| `dim`, `x`, `y`, `z` | int | controller position |
| `dimName` | String? | e.g. `"Overworld"` |
| `name` | String | localized, e.g. `"Electric Blast Furnace"` |
| `type` | String | unlocalized `mName`, e.g. `"multimachine.blastfurnace"` |
| `owner` / `ownerName` | UUID? / String? | `null` owner means admin-only |
| `status` | `GTMachineStatus` | see below |
| `statusDetail` | String? | human-readable reason (GT shutdown reason or check-recipe result) |
| `progressTicks`, `maxProgressTicks` | int | 0/0 when idle |
| `euPerTick` | long | **positive = consumes**, negative = generates (opposite of GT's internal sign) |
| `voltageTier` | int | 0 = ULV … 5 = IV, 6 = LuV, 7 = ZPM; -1 unknown |
| `efficiency` | int | 0..10000 |
| `maintenanceIssues` | List&lt;String&gt; | missing tools: `"Wrench"`, `"Screwdriver"`, `"Soft Mallet"`, `"Hard Hammer"`, `"Soldering Tool"`, `"Crowbar"` |
| `outputs` | List&lt;GTStack&gt; | outputs of the recipe in progress |
| `lastSeenMillis`, `loaded` | long, boolean | **set by core** (the provider leaves them alone) |

`GTMachineStatus` lists problems first. **Declaration order is the UI sort order:**
`STRUCTURE_INCOMPLETE, MAINTENANCE, NO_POWER, OUTPUT_FULL, STOPPED, DISABLED, IDLE, RUNNING`.

`GTStack { String id; String name; long amount; boolean fluid; }`. `id` uses the same format as AE2's
`IAEKey.web$getItemID()` on 1.7.10: `GameRegistry.findUniqueIdentifierFor(item) + ":" + damage` for
items, and `fluid.getName()` for fluids. Fluid amounts are in mB (L).

`GTPowerSourceSnapshot`:

| field | type | notes |
|---|---|---|
| `id` | String | `lscId(dim,x,y,z)` → `"lsc:0:100:64:-300"`, or `wirelessId(teamLeader)` → `"wireless:<uuid>"` |
| `kind` | `LSC` / `WIRELESS` | |
| `name`, `owner`, `ownerName` | | for wireless, `owner` = team leader |
| `stored` | BigInteger | never null |
| `capacity` | BigInteger? | null for wireless |
| `avgInPerTick`, `avgOutPerTick` | Long? | from the LSC's own 5 s averages; null for wireless |
| `dim`, `x`, `y`, `z` | Integer? | null for wireless |

## 2. Engine behaviour (`core/gt/GTEngine`)

- Called from `CoreEngine.onServerTick()`. It does nothing unless a provider is registered **and**
  `gregtech.enabled`.
- Every `gregtech.scan_interval_seconds` it runs one `scan()` on the server thread and records the time it took.
  The time appears as `scanMicros` in `/api/gt/machines`. A scan over 5 ms logs a warning, at most once every 10
  minutes. A throwing scan is caught (Throwable), logged, and retried after 1 minute.
- After each scan:
  - teams are merged
  - the machine registry is updated: missing machines become `loaded:false` with their last state kept, and
    are forgotten after `gregtech.machine_forget_days`
  - power "latest" and the 5-minute exact rate window are updated
  - every `gregtech.power_sample_interval_seconds` one power history point is recorded
- Every 15 minutes (first run 15 minutes after start) it prunes and saves dirty stores on the background
  writer. `onServerStopping` saves synchronously.

## 3. Stored data

| file | content |
|---|---|
| `gtmachines.json` | `{schemaVersion:1, machines:{id → GTMachineSnapshot}}`. Reloaded entries start as `loaded:false`. |
| history database `ae2wi_power_fine`/`_hourly` | One row per power source, key (`stored`, `avg_in`, `avg_out`) and sample. Values are saturated at Long.MAX. Current values (`latest`) are not persisted. |
| history database `ae2wi_production_*`/`ae2wi_consumption_*` | Hourly and daily counters per (machine, stack); machine names/owners, stack names and `trackingSinceMillis` are the `gtproduction` row of `ae2wi_meta`. |

## 4. Visibility (`core/gt/GTVisibility`)

- Admin and localhost principals see everything.
- A player sees an object when `owner == player` or `team(owner) == team(player)`. An unknown player is a
  team of one.
- `owner == null` means admin-only.
- An invisible machine or power source answers `NOT_FOUND` (the same as a missing one).
- This applies identically to machines, power sources and production rows.

## 5. Endpoints

All of them are `@Endpoint` `IAsyncRequest`s under `/api/gt` (`http/endpoint/gt/`) on the HTTP thread, use
the usual `{status, data}` envelope, and need a login. They have no `gridKey`. Machine and power-source ids
are path segments; everything else is a query parameter.

Common statuses:
- `NOT_AVAILABLE`: no provider, or `gregtech.enabled = false`
- `BAD_PARAM`
- `NOT_FOUND`

`range` takes `15m 1h 6h 24h 7d 30d 90d all`, or `custom&minutes=N`. It is clamped to the retention of the
relevant store. `points` defaults to 120 and is clamped to `[1,500]`. It is a **maximum**, since buckets are
merged in whole steps.

### `GET /api/gt/machines`

Returns every visible machine, sorted loaded-first, then by status order, then name, then id. `summary`
counts loaded machines only and always contains every status.

```json
{"status":"OK","data":{
  "scannedAt":1791395242588, "scanMicros":12, "unloaded":0,
  "summary":{"STRUCTURE_INCOMPLETE":0,"MAINTENANCE":1,"NO_POWER":0,"OUTPUT_FULL":0,"STOPPED":0,"DISABLED":0,"IDLE":0,"RUNNING":1},
  "machines":[
    {"id":"0:130:64:-340","dim":0,"dimName":"Overworld","x":130,"y":64,"z":-340,
     "name":"Vacuum Freezer","type":"multimachine.vacuumfreezer",
     "owner":"0f3c2b1a-1111-4222-8333-444455556666","ownerName":"Nico",
     "status":"MAINTENANCE","statusDetail":"Maintenance required",
     "progressTicks":0,"maxProgressTicks":0,"euPerTick":0,"voltageTier":4,"efficiency":8000,
     "maintenanceIssues":["Wrench","Soft Mallet"],"outputs":[],
     "lastSeenMillis":1791395242588,"loaded":true},
    {"id":"0:120:64:-340", "...":"...", "name":"Electric Blast Furnace","status":"RUNNING","statusDetail":null,
     "progressTicks":400,"maxProgressTicks":1200,"euPerTick":7680,"voltageTier":5,"efficiency":10000,
     "maintenanceIssues":[],
     "outputs":[{"id":"gregtech:gt.metaitem.01:11028","name":"Titanium Ingot","amount":1,"fluid":false}],
     "lastSeenMillis":1791395242588,"loaded":true}
  ]}}
```

### `GET /api/gt/machines/{machineId}[?range=24h]`

Returns `{machine: GTMachineSnapshot, production: <same shape as gt/production groupBy=item, limited to this
machine>}`.

### `GET /api/gt/power`

EU amounts are **decimal strings**, because they go past 2^53. `fill` is 0..1 and null without a capacity.
`netPerTick` uses the source's averages when both are present. Otherwise it is the stored-EU change over the
last 5 minutes of scans, and null until two scans exist. `secondsToEmpty` is only set when draining.
`secondsToFull` is only set when filling and a capacity exists. `loaded` means the source was part of the
latest scan. Sources are sorted by kind (LSC first), then name.

```json
{"status":"OK","data":{"sources":[
  {"id":"lsc:0:100:64:-300","kind":"LSC","name":"Lapotronic Supercapacitor",
   "owner":"0f3c…","ownerName":"Nico","stored":"8200000000","capacity":"12000000000","fill":0.683333,
   "avgInPerTick":30000,"avgOutPerTick":21500,"netPerTick":8500,"secondsToEmpty":null,"secondsToFull":22352,
   "dim":0,"x":100,"y":64,"z":-300,"sampledAt":1791395242588,"loaded":true},
  {"id":"wireless:0f3c…","kind":"WIRELESS","name":"Wireless EU (Nico)","owner":"0f3c…","ownerName":"Nico",
   "stored":"123456789012345678901234","capacity":null,"fill":null,
   "avgInPerTick":null,"avgOutPerTick":null,"netPerTick":null,"secondsToEmpty":null,"secondsToFull":null,
   "dim":null,"x":null,"y":null,"z":null,"sampledAt":1791395242588,"loaded":true}]}}
```

### `GET /api/gt/power/{sourceId}/history[?range=24h][&points=120]`

The fine tier is used when the range is ≤ `gregtech.power_fine_retention_hours`, otherwise the hourly tier. Each
point is the newest sample in its window. `-1` means no sample. Values are saturated at Long.MAX
(9.22e18). Only sources currently in `gt/power` are served.

```json
{"status":"OK","data":{"source":"lsc:0:100:64:-300","from":1791394320000,"to":1791395220000,
  "stepMillis":240000,"resolution":"fine",
  "stored":[-1,-1,-1,8200000000],"avgIn":[-1,-1,-1,30000],"avgOut":[-1,-1,-1,21500]}}
```

### `GET /api/gt/production[?range=24h][&groupBy=item|machine][&machine=<id>]`

Totals over the range, largest first. Each row has a `breakdown`: per machine when `groupBy=item`, per
item when `groupBy=machine`.
- `from` is the start of the first **whole** bucket counted, so a range starting mid-hour counts that whole
  hour.
- `resolution` is `hourly` when the range fits in `gregtech.production_hourly_retention_days`, else `daily`.
- `perHour = total / spanMillis`. Here `spanMillis` is the range, shortened to start at `trackingSince`
  when recording began inside it, but never less than 5 minutes.
- `fluid` is always `false` on machine rows and machine breakdown entries.

```json
{"status":"OK","data":{"from":1791306000000,"to":1791395242665,"spanMillis":86400000,
  "trackingSince":1790000000000,"resolution":"hourly","groupBy":"item","rows":[
  {"key":"helium","name":"Helium","fluid":true,"total":4000,"perHour":166.67,"breakdown":[
     {"key":"0:130:64:-340","name":"Vacuum Freezer","fluid":false,"total":4000,"perHour":166.67,"breakdown":[]}]},
  {"key":"gregtech:gt.metaitem.01:11028","name":"Titanium Ingot","fluid":false,"total":108,"perHour":4.5,"breakdown":[
     {"key":"0:120:64:-340","name":"Electric Blast Furnace","fluid":false,"total":96,"perHour":4.0,"breakdown":[]},
     {"key":"0:130:64:-340","name":"Vacuum Freezer","fluid":false,"total":12,"perHour":0.5,"breakdown":[]}]}]}}
```

### `GET /api/gt/production/history[?item=<stackId>][&machine=<id>][&range=7d][&points=120]`

Returns the amount produced per window (a **sum**, so `0` means nothing produced, never a gap), summed over
the visible machines. Without `item`, every stack is summed, which only makes sense together with
`machine`.

```json
{"status":"OK","data":{"stack":"helium","machine":null,"from":1791370800000,"to":1791392400000,
  "stepMillis":7200000,"resolution":"hourly","points":[0,0,0,4000]}}
```

## 6. Page context

`AE2Controller.WebHandler` replaces `_REPLACE_ME_HAS_GT` with `true` or `false` (`GTEngine.isAvailable()`).
⚠ The placeholders in `webpage.html` are **bare JS literals**. Every server of that page must replace it,
including `example_website/index.php` (Phase 2 adds that line). Otherwise the page throws a ReferenceError.

## 7. Config keys (`[gregtech]` in `config/ae2webintegration/config.toml`, `ConfigSettings.GregTech`)

| key | default | range | meaning |
|---|---|---|---|
| `gregtech.enabled` | true | | master switch for the GT pages |
| `gregtech.scan_interval_seconds` | 10 | 2–300 | scan cadence |
| `gregtech.power_sample_interval_seconds` | 30 | 10–3600 | power history resolution (rounded up to whole scans) |
| `gregtech.power_fine_retention_hours` | 24 | 1–168 | fine power history |
| `gregtech.power_hourly_retention_days` | 30 | 1–365 | hourly power history |
| `gregtech.production_hourly_retention_days` | 7 | 1–30 | hourly production buckets |
| `gregtech.production_daily_retention_days` | 90 | 1–3650 | daily production buckets |
| `gregtech.machine_forget_days` | 7 | 1–365 | drop machines unseen this long |

## 8. Tests

- `core/gt/BucketSeriesTest`
- `GTProductionLogTest`
- `GTPowerHistoryStoreTest`
- `GTEngineTest` (scheduling, backoff, registry lifecycle, team merge, persistence)
- `core/GTRequestTest`: every endpoint, including `NOT_AVAILABLE`, visibility, team, ownerless, and the
  param errors

`GTTestSupport` (test sources, public) gives other tests a fake provider and `scan(provider, nowMillis)`.

## Definition of done ✅
- [x] `./gradlew build` green (JUnit + spotless)
- [x] No Minecraft/GT imports in core
- [x] Branches without a provider are unaffected: endpoints answer `NOT_AVAILABLE`, `_REPLACE_ME_HAS_GT=false`
- [x] Committed on `core`. **Not pushed.**
