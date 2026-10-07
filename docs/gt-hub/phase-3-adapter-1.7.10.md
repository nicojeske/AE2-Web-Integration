# Phase 3: 1.7.10 adapter: GregTech provider and production mixin

Branch: `1.7.10` (Forge 1.7.10, RFG / GTNH buildscript, `core` as a git submodule at `core/`).
Prerequisite reading: `CLAUDE.md` on `core` (the architecture section), [phase-1-core.md](phase-1-core.md)
§1–2 (what the provider must return) and §5 (to check the result in a browser).

All GT names below were **verified against GT5-Unofficial tag `5.09.54.205`** (the version in GTNH
2.9.0-RC-2). GT is not obfuscated, so mixin targets use plain names. Re-verify anything marked ⚠.

## 0. Submodule first: it points at upstream ⚠

`1.7.10:.gitmodules` currently has `url = https://github.com/kuba6000/AE2-Web-Integration.git`. The Phase 1
commits only exist in the fork (`nicojeske/AE2-Web-Integration`, branch `core`). Before anything else:

1. Point the submodule at the fork:
   `git submodule set-url core https://github.com/nicojeske/AE2-Web-Integration.git`
   (or SSH `git@github.com:nicojeske/AE2-Web-Integration.git`, to match how this repo is cloned).
2. `git -C core fetch && git -C core checkout <core sha with Phase 1 (and 2)>`, then commit the new pin.
   Locally you can also add the main worktree as a remote of the submodule, so you don't have to push first.
3. Mention to the user that `update-core-pins.yml` runs on push to `core`. With the URL changed, it bumps
   the pin to fork commits, which is what we want. Check that the workflow reads the URL from `.gitmodules`
   rather than hard-coding upstream.

## 1. Dependencies (`dependencies.gradle`, `gradle.properties`, `mcmod.info`)

Match the live server (GTNH 2.9.0-RC-2):

```groovy
api("com.github.GTNewHorizons:GTNHLib:0.11.52:dev")                                    // was 0.11.39
api("com.github.GTNewHorizons:Applied-Energistics-2-Unofficial:rv3-beta-1080-GTNH:dev") // was rv3-beta-999 (server runs 1080)
compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.205:dev") { transitive = false }
// For ./gradlew runServer with GT present (pulls StructureLib, ModularUI(2), IC2, NEI, …):
runtimeOnlyNonPublishable("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.205:dev")
```

- Repository: `https://nexus.gtnewhorizons.com/repository/public/`. It is already present via
  `includeWellKnownRepositories` / the GTNH settings plugin. Both jars were checked to resolve (HTTP 200).
- GT 5.09.54.205's own dependencies (for reference, if `runServer` complains):
  - `StructureLib:1.4.45`
  - `GTNHLib:0.11.52`
  - `ModularUI:1.3.4`
  - `ModularUI2:2.3.92-1.7.10`
  - `NotEnoughItems:2.8.155-GTNH`
  - `industrialcraft-2:2.2.828-experimental`
  - `AE2 rv3-beta-1079-GTNH`
  - `chunkapi 0.8.3`
  - `endlessids 1.7.3`
- If the AE2 bump breaks compilation of existing mixins, fix that in a separate commit **first**.
- `@Mod(dependencies = "required-after:appliedenergistics2;after:gregtech")`. GT stays **optional**: the
  mod must still load and serve AE2 on a pack without GT.

## 2. Verified GT API (5.09.54.205)

| need | API |
|---|---|
| tile → MTE | `gregtech.api.interfaces.tileentity.IGregTechTileEntity#getMetaTileEntity()` → `IMetaTileEntity` |
| owner | `IGregTechTileEntity#getOwnerUuid()` (UUID), `#getOwnerName()` (`"Player"` if unset) |
| position | `getXCoord()` int, **`getYCoord()` short**, `getZCoord()` int, `getWorld()` |
| state | `isActive()`, `isAllowedToWork()`, `getProgress()`, `getMaxProgress()` (from `IMachineProgress`) |
| shutdown reason | `IGregTechTileEntity#getLastShutDownReason()` → `gregtech.api.util.shutdown.ShutDownReason` (`getKey()`, `getID()`, `getDisplayString()`, `wasCritical()`). Compare against the constants in `ShutDownReasonRegistry`: `NONE, CRITICAL_NONE, POWER_LOSS, POLLUTION_FAIL, FLUID_OUTPUT_FAILED, ITEM_OUTPUT_FAILED, STRUCTURE_INCOMPLETE, NO_REPAIR, NO_TURBINE, NO_ROTOR, WIND_LOW, WIND_HIGH, NO_MACHINE_PART, INSUFFICIENT_DYNAMO, OVERHEAT_FAIL`. The factories `outOfFluid`, `outOfItem` and `outOfStuff` make new instances, so compare those by `getID()`. |
| multiblock base | `gregtech.api.metatileentity.implementations.MTEMultiBlockBase` |
| its fields | `public boolean mMachine, mWrench, mScrewdriver, mSoftMallet, mHardHammer, mSolderingTool, mCrowbar`; `public int mProgresstime, mMaxProgresstime, mEUt, mEfficiency`; `public ItemStack[] mOutputItems; public FluidStack[] mOutputFluids` |
| EU/t | `mEUt` (int) on the base. **`MTEExtendedPowerMultiBlockBase#lEUt` (long)** on extended multis: use `lEUt` when `instanceof MTEExtendedPowerMultiBlockBase`. GT stores consumption as a **negative** number, and core wants **positive = consumes**, so negate. |
| maintenance | `getRepairStatus()` (count of true tool booleans), `getIdealStatus()` (6). A tool boolean that is **false** means that tool is needed. Respect `MTEMultiBlockBase.disableMaintenance` (static) and the per-machine `hasMaintenanceChecks` field. |
| last recipe check | `MTEMultiBlockBase#getCheckRecipeResult()` → `gregtech.api.recipe.check.CheckRecipeResult` (`wasSuccessful()`, `getDisplayString()`, `getID()`) |
| names | `IMetaTileEntity#getLocalName()` (localized on the server = en_US), `#getMetaName()` (internal `mName`) |
| tier | `MTEMultiBlockBase#getInputVoltageTier()` (long; 0 when hatches are mixed). Fallback `GTUtility.getTier(getMaxInputVoltage())`. |
| LSC | `kekztech.common.tileentities.MTELapotronicSuperCapacitor` (extends `MTEEnhancedMultiBlockBase`): `getStored()` BigInteger, `getEnergyCapacity()` BigInteger, `getEnergyInputValues().avgLong()` / `getEnergyOutputValues().avgLong()` (5 s averages, EU/t), `isWireless_mode()` |
| wireless EU | `gregtech.common.misc.WirelessNetworkManager.getUserEU(UUID)` → BigInteger (resolves the team leader internally) |
| teams | `gregtech.common.misc.spaceprojects.SpaceProjectManager`: ⚠ `getLeader(UUID)` calls `checkOrCreateTeam` and **may create a team and mark save data dirty**. Do **not** call it during a scan. Read the public `Map<UUID,UUID> spaceTeams` instead (`spaceTeams.getOrDefault(uuid, uuid)`). |
| machine registry | none exists in GT. Walk `world.loadedTileEntityList` (below). |

Names that changed since 2.7: `CommonMetaTileEntity` changed meaning, so don't reference it. The LSC
getters are new. `getInfoData()` now returns encoded keys (use `IGregTechDeviceInformation.decode`). The
output code in `runMachine` was rewritten, so mixins written against 2.7 bytecode will not apply.

## 3. Status derivation (`GTStatusMapper`)

Check in this order. The first match wins:

| # | condition | status | statusDetail |
|---|---|---|---|
| 1 | `!mte.mMachine` | `STRUCTURE_INCOMPLETE` | "Structure incomplete" |
| 2 | maintenance enabled for this machine && `getRepairStatus() < getIdealStatus()` | `MAINTENANCE` | "Maintenance required" |
| 3 | `!igte.isAllowedToWork()` && reason ∈ {`POWER_LOSS`, `INSUFFICIENT_DYNAMO`} | `NO_POWER` | `reason.getDisplayString()` |
| 4 | `!igte.isAllowedToWork()` && reason ∈ {`ITEM_OUTPUT_FAILED`, `FLUID_OUTPUT_FAILED`} | `OUTPUT_FULL` | display string |
| 5 | `!igte.isAllowedToWork()` && reason is not `NONE` or `CRITICAL_NONE` | `STOPPED` | display string |
| 6 | `!igte.isAllowedToWork()` | `DISABLED` | "Disabled" |
| 7 | `mMaxProgresstime > 0` (or `igte.isActive()`) | `RUNNING` | null |
| 8 | otherwise | `IDLE` | `getCheckRecipeResult().getDisplayString()` if not successful and not `NONE`, else null |

`maintenanceIssues`: for each tool flag that is false, emit its English name (`"Wrench"`, `"Screwdriver"`,
`"Soft Mallet"`, `"Hard Hammer"`, `"Soldering Tool"`, `"Crowbar"`). The list is empty when maintenance is
disabled.

Running outputs: copy `mOutputItems` and `mOutputFluids` (null-safe) to `GTStack`s using
`GTStacks.of(ItemStack)` / `GTStacks.of(FluidStack)` (below).

⚠ Wrap the per-machine mapping in try/catch(Throwable). Log once per machine type, then skip that machine,
so one odd multiblock can't kill the scan.

## 4. Provider (`ae2interface/gt/GTProvider implements IGTProvider`)

```java
public GTScanResult scan(long nowMillis) {
    GTScanResult r = new GTScanResult();
    Set<UUID> owners = new HashSet<>();
    for (WorldServer world : DimensionManager.getWorlds()) {
        String dimName = world.provider.getDimensionName();
        // Index loop, not an iterator: loadedTileEntityList is an ArrayList that nothing else mutates during
        // our tick-end call, but never hold it across ticks.
        List<TileEntity> tes = world.loadedTileEntityList;
        for (int i = 0, n = tes.size(); i < n; i++) {
            TileEntity te = tes.get(i);
            if (!(te instanceof IGregTechTileEntity)) continue;
            IGregTechTileEntity igte = (IGregTechTileEntity) te;
            IMetaTileEntity mte = igte.getMetaTileEntity();
            if (mte instanceof MTELapotronicSuperCapacitor) r.powerSources.add(lsc(...));   // LSC is also a multiblock: add to both lists
            if (mte instanceof MTEMultiBlockBase) r.machines.add(machine(...));
            owners.add(igte.getOwnerUuid());
        }
    }
    for (UUID leader : distinct team leaders of owners) r.powerSources.add(wireless(leader));
    // teams: owners + online players (MinecraftServer.getServer().getConfigurationManager().playerEntityList)
    for (UUID p : owners ∪ online) r.teams.put(p, SpaceProjectManager.spaceTeams.getOrDefault(p, p));
    return r;
}
```

- **Wireless**: one source per distinct team leader of the scanned owners, using `getUserEU(leader)`. Skip
  a team whose EU is 0 and which has never been non-zero, so wireless-less players don't get empty cards.
  `name` = `"Wireless EU (" + leaderName + ")"`.
- **LSC**: `id = GTPowerSourceSnapshot.lscId(dim,x,y,z)`, with averages from `getEnergyInputValues().avgLong()`
  and `getEnergyOutputValues().avgLong()`.
- **Cost**: one pass over `loadedTileEntityList` per dimension every 10 s. GTNH bases have tens of thousands
  of TEs, and `instanceof` filtering is microseconds per thousand. Core logs anything over 5 ms. Measure on
  the real server (`scanMicros` in `/gt/machines`).
- Uses `GameRegistry.findUniqueIdentifierFor` and `FluidStack.getFluid().getName()`, so the IDs match AE2's
  `AEStackMixin.web$getItemID()` exactly. **Reuse that logic in one helper** (`GTStacks`) rather than
  re-deriving it.

## 5. Production hook (`ae2interface/mixins/GT/…`)

⚠ **Do not hook `outputAfterRecipe()`.** Its body is empty, and by then `mOutputItems`/`mOutputFluids`
are already null.

**Mixin A** (covers MTEMultiBlockBase, MTEExtendedPowerMultiBlockBase, GT++ `GTPPMultiBlockBase`,
bartworks, and the ~15 `runMachine` overrides that call super):

```java
@Mixin(value = MTEMultiBlockBase.class, remap = false)
public abstract class MTEMultiBlockBaseProductionMixin {
    @Shadow public ItemStack[] mOutputItems;
    @Shadow public FluidStack[] mOutputFluids;

    @Inject(method = "runMachine",
        at = @At(value = "FIELD",
                 target = "Lgregtech/api/metatileentity/implementations/MTEMultiBlockBase;mOutputItems:[Lnet/minecraft/item/ItemStack;",
                 opcode = Opcodes.PUTFIELD, ordinal = 0))
    private void ae2web$recordOutputs(IGregTechTileEntity base, long tick, CallbackInfo ci) {
        GTProductionHook.record((MTEMultiBlockBase) (Object) this, base, mOutputItems, mOutputFluids);
    }
}
```

The injection point is the first `mOutputItems = null` after `addItemOutputs(...)` and `addFluidOutputs(...)`
in the completion branch of `runMachine` (around line 813 in 5.09.54.205), where both arrays are still
filled. Confirm `ordinal = 0` is that write by checking the bytecode (`javap -c` on the dev jar). The
branch is:

```java
if (mProgresstime >= mMaxProgresstime) {
    ... drone-downlink record ...
    boolean isOutputAllItems = mOutputItems == null || addItemOutputs(mOutputItems);
    boolean isOutputAllFluids = mOutputFluids == null || addFluidOutputs(mOutputFluids);
    mOutputItems = null;        // <- inject here (before this PUTFIELD)
    mOutputFluids = null;
    outputAfterRecipe();
```

**Mixin B: TecTech.** `tectech.thing.metaTileEntity.multi.base.TTMultiblockBase` overrides `onPostTick` with
its own loop. Inject at `HEAD` of `addClassicOutputs_EM()`, which pushes `mOutputItems`/`mOutputFluids`
itself.

**Not covered (accepted in v1, list them in the UI docs):** `MTEWormholeGenerator`,
`MTEPurificationPlant`, `MTEPurificationUnitBase` (they override `runMachine` without calling super), and
some generator or turbine `onPostTick` overrides that were not audited. These are mostly generators, which
produce no items anyway.

`GTProductionHook.record(...)` (plain Java, server thread, cheap):
- Build `machineId` from base coords and dim (`GTMachineSnapshot.idOf`), `name = getLocalName()`, and
  `owner = base.getOwnerUuid()`.
- For each non-null stack with size > 0, call
  `IAEWebInterface.getInstance().recordGTProduction(id, name, owner, GTStacks.id(s), GTStacks.name(s), amount, fluid)`.
- Wrap everything in try/catch(Throwable), log once, and never throw into GT's tick.

**Machine removal** (optional, nice to have): inject at `HEAD` of `MTEMultiBlockBase#onRemoval()` (verify
the name ⚠; `IMetaTileEntity` has `onRemoval()`) and call `gtMachineRemoved(id)`. Without it, broken
machines simply expire after `gt_machine_forget_days`.

### Mixin loading ⚠

The existing `MixinPlugin.getMixins()` returns a static list of AE2 mixins (AE2 is a mod, so look at **how
those load today**: early vs. late, the UniMixins/GTNHMixins late loader). The GT mixins must:

1. load only when GT is present: check for the class
   `gregtech/api/metatileentity/implementations/MTEMultiBlockBase.class` as a resource, not
   `Loader.isModLoaded`, because mixin config runs before FML mod discovery
2. be listed separately as `"GT.MTEMultiBlockBaseProductionMixin"` and `"GT.TTMultiblockBaseProductionMixin"`
   (the latter only when `tectech/.../TTMultiblockBase.class` is present)
3. be late mixins if the AE2 ones are, since GT is a regular mod jar

If the existing setup can't do conditional late mixins, use GTNHLib's / UniMixins' late mixin loader
(`@LateMixin` + `ILateMixinLoader`, or the GTNHLib equivalent in 0.11.x; check what
`Applied-Energistics-2-Unofficial` or another GTNH mod on GTNHLib 0.11 uses). `defaultRequire: 1` in the
JSON means a failed injection crashes at load. Keep that for Mixin A (we want to know), but make Mixin B
`require = 0`.

## 6. Registration (`AE2WebIntegration.java`)

In `init` (after `initAEInterface`):

```java
if (Loader.isModLoaded("gregtech")) {
    IAEWebInterface.getInstance().registerGTProvider(new GTProvider());
}
```

Keep every GT class reference behind this check. `GTProvider` and the hook classes may only be
**class-loaded** when GT is present, so don't reference them from always-loaded code paths. The core
interfaces are fine.

## 7. Test procedure

1. `./gradlew build` on `1.7.10`, which also builds core through the submodule.
2. `./gradlew runServer`, then in a creative test world (op yourself):
   - build an EBF with an LV/MV energy hatch, maintenance hatch, and in/out busses, plus an LSC
   - open `http://localhost:2324/gt/machines` (localhost is admin) and confirm the EBF appears within 10 s
     with the right `type`, `voltageTier` and owner
   - break one casing → `STRUCTURE_INCOMPLETE`; restore it, then add a maintenance problem → `MAINTENANCE`
     with issue names
   - disable with a soft mallet → `DISABLED`; cut power mid-recipe → `NO_POWER` (`statusDetail` from
     `POWER_LOSS`); fill the output bus → `OUTPUT_FULL`
   - run recipes, then check `/gt/production?range=1h` and confirm the totals match the items actually output
     (count them in the bus)
   - `/gt/power`: check LSC stored, capacity and averages against the LSC GUI
   - wireless: put EU in via a wireless dynamo (or `/gt` command if available) and confirm the `wireless:`
     source and that `netPerTick` shows up after two scans
   - move far away to unload the chunk, then confirm the machine shows `loaded:false` and keeps its last
     state
   - check `scanMicros` and the server log for the slow-scan warning
3. With the GT jar removed from the dev run: the mod still loads, AE2 works, `/gt/machines` returns
   `NOT_AVAILABLE`, and no `NoClassDefFoundError` appears in the log.

## 8. Rollout (needs the user's explicit go-ahead)

1. Build the jar: `./gradlew build` produces `build/libs/ae2webintegration-*-forge-1.7.10.jar` (not the
   `-dev`/`-sources` jars).
2. Confirm the velero/kopia backup for `gtnhts` is recent:
   `ssh njeske@nmaster1.node 'kubectl -n velero get backups'`, or ask the user.
3. Copy it in:
   `kubectl -n gtnhts cp <jar> <pod>:/data/mods/`
   then remove `/data/mods/ae2webintegration-2.0.4-forge-1.7.10.jar`. The config file is kept, and new
   `gt_*` keys get their defaults.
4. Restart: `kubectl -n gtnhts rollout restart deploy/gtnhts-minecraft`. Watch
   `kubectl -n gtnhts logs -f deploy/gtnhts-minecraft | grep -i 'ae2webintegration\|GregTech'` for
   "GregTech provider registered" and any mixin errors.
5. Watch for the first hour:
   - `scanMicros`
   - TPS (`/forge tps` in game or through RCON)
   - the slow-scan warning
   - `config/ae2webintegration/gt*.json` appearing after about 15 minutes

## 9. Checklist / definition of done
- [x] Submodule URL points at the fork, and the pin includes Phase 1
- [x] Deps bumped (GTNHLib 0.11.52, AE2 rv3-beta-1080) and GT 5.09.54.205 compileOnly/runtime; `after:gregtech`
- [x] `GTStacks` shared with the AE2 item-ID logic
- [x] `GTStatusMapper` per §3, with a unit test for the mapping if testable without a world (plain booleans/enums in, status out)
- [x] `GTProvider` (machines, LSCs, wireless, teams), robust per machine
- [x] Mixin A (runMachine PUTFIELD), plus Mixin B (TecTech), loaded only with GT present
- [x] Optional removal hook
- [x] Registration guarded by `Loader.isModLoaded("gregtech")`
- [x] runServer test procedure §7 passed, including the no-GT run
- [x] Commits on `1.7.10`; update the README phase table
- [ ] Rollout §8 only after the user says go
