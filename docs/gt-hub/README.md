# GregTech hub: machines, power and production in the AE2 web terminal

These specs describe the GregTech pages added to this fork. With them, the web terminal that already shows
the AE2 network also shows:

- **Machines**: every GregTech multiblock you own, with its status (running, idle, out of power, output full,
  maintenance, structure incomplete), progress, EU/t, maintenance issues and location. Machines are found
  automatically, so there is no wiring and no OpenComputers.
- **Power**: Lapotronic Supercapacitors and the team's wireless EU network, with fill level, net EU/t, time
  until empty or full, and history.
- **Production**: what each machine produced, per item, per hour or day.

Out of scope for v1: Discord alerts, remote on/off, quests, pollution.

## Target environment

| | |
|---|---|
| Pack | GTNH **2.9.0-RC-2** |
| GregTech | `GT5-Unofficial` **5.09.54.205** |
| GTNHLib | 0.11.52 |
| AE2 | `appliedenergistics2-rv3-beta-1080-GTNH` |
| Server | k8s `nmaster1.node`, namespace `gtnhts`, deployment `gtnhts-minecraft` (image `itzg/minecraft-server:java25`, data in `/data`). It currently runs upstream `ae2webintegration-2.0.4`. |

## Architecture

```
 1.7.10 branch (Forge, GT5u)                    core branch (pure Java 8)                         web/ (Preact)
 ┌──────────────────────────────┐   scan()      ┌────────────────────────────────────┐  JSON     ┌──────────────────┐
 │ GTProvider implements        │◀──────────────│ gt/GTEngine (server tick)          │──────────▶│ Machines view     │
 │   IGTProvider                │  every 10 s   │  ├ GTMachineRegistry  gtmachines.json│/api/gt/*│ Power view        │
 │ walks loadedTileEntityList   │               │  ├ GTPowerHistoryStore gtpower.json │          │ Production view   │
 │ Mixin on MTEMultiBlockBase   │ recordGT-     │  ├ GTProductionLog gtproduction.json│          └──────────────────┘
 │   .runMachine (outputs)      │──Production──▶│  └ GTVisibility (owner / GT team)   │
 └──────────────────────────────┘               │ http/endpoint/gt/* (6 endpoints)   │
                                                └────────────────────────────────────┘
```

- Core never imports Minecraft or GregTech. It defines `IGTProvider` plus DTOs (`core/api/gt/*`). The
  `1.7.10` branch implements the provider and registers it with
  `IAEWebInterface.getInstance().registerGTProvider(...)`.
- Without a provider, which is the case on the other branches, every `/api/gt/*` endpoint answers `NOT_AVAILABLE`,
  `_REPLACE_ME_HAS_GT` becomes `false`, and the UI hides the GT sections.
- The three history stores keep JSON files by default. With `history.jdbc_url` set they use PostgreSQL
  (TimescaleDB if installed) instead; see "History database (optional)" in the [main README](../../README.md).
- Live GregTech state is only read during the scan, which runs on the server tick. HTTP handlers only ever read
  what the scan stored. This is the same split as the existing `IAsyncRequest` endpoints.

## Phases

| Phase | Branch | Spec | Status |
|---|---|---|---|
| 0: version check | live server | (this file) | ✅ done |
| 1: core: provider API, stores, endpoints, tests | `core` | [phase-1-core.md](phase-1-core.md) | ✅ done (`db97705`, `db584c0`) |
| 2: web frontend: Machines, Power, Production views | `core` (`web/`) | [phase-2-frontend.md](phase-2-frontend.md) | ✅ done (`6ea72f7`, `8980264`) |
| 3: 1.7.10 adapter: GT provider and production mixin | `1.7.10` | [phase-3-adapter-1.7.10.md](phase-3-adapter-1.7.10.md) | ✅ done (`704ffcf`, `1ed5431`, `dad0fc4`, `c6fe031`, `d8b042f`) |
| Rollout to the live server | live server | [phase-3 §8](phase-3-adapter-1.7.10.md#8-rollout-needs-the-users-explicit-go-ahead) | ⏸ pending, needs the user's go-ahead |

Phases 2 and 3 are independent and can be done in either order. Phase 2 can be built and checked entirely
against the Vite mock server, and Phase 3 against `/api/gt/*` JSON in a browser. Rollout to the live server
needs both.

## Starting a session on a phase

Open a fresh session in `~/projects/AE2-Web-Integration` and say:

> Read `CLAUDE.md`, `docs/gt-hub/README.md`, `docs/gt-hub/phase-1-core.md` and `docs/gt-hub/phase-N-….md`,
> then implement phase N. Work directly on the branch named in the spec and commit as you go.

[phase-1-core.md](phase-1-core.md) is the **contract**: endpoint shapes, status values, ID formats and
config keys. If a later phase needs a contract change, make it on `core` (with tests), then update
phase-1-core.md in the same commit.

## Working conventions (from the user)

- Work directly on `core` and `1.7.10`, with no feature branches. Commit as you go, ending messages with the
  `Co-Authored-By` trailer.
- Pushing is a separate decision. A push to `core` runs `update-core-pins.yml`, which bumps the submodule pin
  on every version branch.
- kubectl lives on `ssh njeske@nmaster1.node`, not locally. Only read-only commands there without asking. The
  rollout (swapping the jar and restarting) needs explicit approval.
