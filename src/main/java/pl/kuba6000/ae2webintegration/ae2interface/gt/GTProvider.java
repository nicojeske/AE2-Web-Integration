package pl.kuba6000.ae2webintegration.ae2interface.gt;

import java.math.BigInteger;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraft.server.MinecraftServer;
import net.minecraft.tileentity.TileEntity;
import net.minecraft.world.WorldServer;
import net.minecraftforge.common.DimensionManager;

import com.mojang.authlib.GameProfile;

import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.implementations.MTEExtendedPowerMultiBlockBase;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import gregtech.api.recipe.check.CheckRecipeResult;
import gregtech.api.recipe.check.CheckRecipeResultRegistry;
import gregtech.api.util.GTUtility;
import gregtech.api.util.shutdown.ShutDownReason;
import gregtech.api.util.shutdown.ShutDownReasonRegistry;
import gregtech.common.misc.GlobalVariableStorage;
import gregtech.common.misc.spaceprojects.SpaceProjectManager;
import kekztech.common.tileentities.MTELapotronicSuperCapacitor;
import pl.kuba6000.ae2webintegration.ae2interface.AE2WebIntegration;
import pl.kuba6000.ae2webintegration.core.api.gt.GTMachineSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTPowerSourceSnapshot;
import pl.kuba6000.ae2webintegration.core.api.gt.GTScanResult;
import pl.kuba6000.ae2webintegration.core.api.gt.IGTProvider;

/**
 * Snapshots every loaded GregTech multiblock, Lapotronic Supercapacitor and team wireless network. Only
 * class-loaded when GregTech is present (see {@link GTCompat}).
 */
public class GTProvider implements IGTProvider {

    /** MTE classes whose mapping threw once; logged a single time each, then skipped silently. */
    private final Set<Class<?>> failedTypes = Collections.newSetFromMap(new HashMap<>());

    @Override
    public GTScanResult scan(long nowMillis) {
        GTScanResult r = new GTScanResult();
        Set<UUID> players = new HashSet<>();
        for (WorldServer world : DimensionManager.getWorlds()) {
            int dim = world.provider.dimensionId;
            String dimName = world.provider.getDimensionName();
            // Index loop, not an iterator: nothing mutates the list during our tick-end call.
            List<TileEntity> tes = world.loadedTileEntityList;
            for (int i = 0, n = tes.size(); i < n; i++) {
                TileEntity te = tes.get(i);
                if (!(te instanceof IGregTechTileEntity)) continue;
                IGregTechTileEntity igte = (IGregTechTileEntity) te;
                IMetaTileEntity mte = igte.getMetaTileEntity();
                if (!(mte instanceof MTEMultiBlockBase)) continue;
                try {
                    GTMachineSnapshot m = machine((MTEMultiBlockBase) mte, igte, dim, dimName);
                    if (mte instanceof MTELapotronicSuperCapacitor) {
                        r.powerSources.add(lsc((MTELapotronicSuperCapacitor) mte, m));
                    }
                    r.machines.add(m);
                    if (m.owner != null) {
                        players.add(m.owner);
                        if (m.ownerName != null) r.playerNames.put(m.owner, m.ownerName);
                    }
                } catch (Throwable t) {
                    if (failedTypes.add(mte.getClass())) {
                        AE2WebIntegration.LOG.warn("Skipping GregTech machine type {} in scans", mte.getClass(), t);
                    }
                }
            }
        }

        MinecraftServer server = MinecraftServer.getServer();
        for (Object o : server.getConfigurationManager().playerEntityList) {
            EntityPlayerMP p = (EntityPlayerMP) o;
            players.add(p.getUniqueID());
            r.playerNames.put(p.getUniqueID(), p.getCommandSenderName());
        }

        // Read the team map directly: SpaceProjectManager.getLeader (and getUserEU, which calls it) may create a
        // team and dirty GT's save data.
        Map<UUID, UUID> spaceTeams = SpaceProjectManager.spaceTeams;
        Set<UUID> leaders = new LinkedHashSet<>();
        for (UUID p : players) {
            UUID leader = spaceTeams.getOrDefault(p, p);
            r.teams.put(p, leader);
            leaders.add(leader);
        }
        for (UUID leader : leaders) {
            // GT puts a team's leader in the map (with zero EU) once any of its wireless machines is placed, so a
            // team without wireless gets no card.
            BigInteger eu = GlobalVariableStorage.GlobalEnergy.get(leader);
            if (eu == null) continue;
            r.powerSources.add(wireless(leader, eu, ownerName(leader, r.playerNames, server)));
        }
        return r;
    }

    private static GTMachineSnapshot machine(MTEMultiBlockBase mte, IGregTechTileEntity igte, int dim, String dimName) {
        GTMachineSnapshot m = new GTMachineSnapshot();
        m.dim = dim;
        m.dimName = dimName;
        m.x = igte.getXCoord();
        m.y = igte.getYCoord();
        m.z = igte.getZCoord();
        m.id = GTMachineSnapshot.idOf(dim, m.x, m.y, m.z);
        m.name = mte.getLocalName();
        m.type = mte.getMetaName();
        m.owner = igte.getOwnerUuid();
        String ownerName = igte.getOwnerName();
        m.ownerName = ownerName == null || "Player".equals(ownerName) ? null : ownerName;

        GTStatusMapper.Input in = new GTStatusMapper.Input();
        in.formed = mte.mMachine;
        in.maintenanceEnabled = mte.shouldCheckMaintenance();
        in.wrench = mte.mWrench;
        in.screwdriver = mte.mScrewdriver;
        in.softMallet = mte.mSoftMallet;
        in.hardHammer = mte.mHardHammer;
        in.solderingTool = mte.mSolderingTool;
        in.crowbar = mte.mCrowbar;
        in.allowedToWork = igte.isAllowedToWork();
        in.active = igte.isActive();
        ShutDownReason reason = igte.getLastShutDownReason();
        in.reason = classify(reason);
        in.reasonDisplay = reason == null ? null : reason.getDisplayString();
        in.maxProgressTicks = mte.mMaxProgresstime;
        CheckRecipeResult check = mte.getCheckRecipeResult();
        if (check != null && !check.wasSuccessful()
            && !CheckRecipeResultRegistry.NONE.getID()
                .equals(check.getID())) {
            in.failedRecipeCheck = check.getDisplayString();
        }
        GTStatusMapper.Result status = GTStatusMapper.map(in);
        m.status = status.status;
        m.statusDetail = status.detail;
        m.maintenanceIssues = GTStatusMapper.maintenanceIssues(in);

        if (mte.mMaxProgresstime > 0) {
            m.progressTicks = mte.mProgresstime;
            m.maxProgressTicks = mte.mMaxProgresstime;
            // GT stores consumption as a negative number; core wants positive = consumes.
            long eut = mte instanceof MTEExtendedPowerMultiBlockBase ? ((MTEExtendedPowerMultiBlockBase<?>) mte).lEUt
                : mte.mEUt;
            m.euPerTick = -eut;
            GTStacks.addAll(mte.mOutputItems, mte.mOutputFluids, m.outputs);
        }
        m.efficiency = mte.mEfficiency;
        long maxVoltage = mte.getMaxInputVoltage();
        long tier = mte.getInputVoltageTier();
        m.voltageTier = maxVoltage <= 0 ? -1 : tier > 0 ? (int) tier : GTUtility.getTier(maxVoltage);
        return m;
    }

    private static GTStatusMapper.Reason classify(ShutDownReason reason) {
        if (reason == null) return GTStatusMapper.Reason.NONE;
        String id = reason.getID();
        if (is(id, ShutDownReasonRegistry.NONE) || is(id, ShutDownReasonRegistry.CRITICAL_NONE)) {
            return GTStatusMapper.Reason.NONE;
        }
        if (is(id, ShutDownReasonRegistry.POWER_LOSS) || is(id, ShutDownReasonRegistry.INSUFFICIENT_DYNAMO)) {
            return GTStatusMapper.Reason.POWER;
        }
        if (is(id, ShutDownReasonRegistry.ITEM_OUTPUT_FAILED) || is(id, ShutDownReasonRegistry.FLUID_OUTPUT_FAILED)) {
            return GTStatusMapper.Reason.OUTPUT;
        }
        return GTStatusMapper.Reason.OTHER;
    }

    private static boolean is(String id, ShutDownReason known) {
        return known.getID()
            .equals(id);
    }

    private static GTPowerSourceSnapshot lsc(MTELapotronicSuperCapacitor lsc, GTMachineSnapshot m) {
        GTPowerSourceSnapshot s = new GTPowerSourceSnapshot();
        s.id = GTPowerSourceSnapshot.lscId(m.dim, m.x, m.y, m.z);
        s.kind = GTPowerSourceSnapshot.Kind.LSC;
        s.name = m.name;
        s.owner = m.owner;
        s.ownerName = m.ownerName;
        BigInteger stored = lsc.getStored();
        s.stored = stored == null ? BigInteger.ZERO : stored;
        s.capacity = lsc.getEnergyCapacity();
        s.avgInPerTick = lsc.getEnergyInputValues()
            .avgLong();
        s.avgOutPerTick = lsc.getEnergyOutputValues()
            .avgLong();
        s.dim = m.dim;
        s.x = m.x;
        s.y = m.y;
        s.z = m.z;
        return s;
    }

    private static GTPowerSourceSnapshot wireless(UUID leader, BigInteger eu, String leaderName) {
        GTPowerSourceSnapshot s = new GTPowerSourceSnapshot();
        s.id = GTPowerSourceSnapshot.wirelessId(leader);
        s.kind = GTPowerSourceSnapshot.Kind.WIRELESS;
        s.name = "Wireless EU (" + (leaderName != null ? leaderName : leader) + ")";
        s.owner = leader;
        s.ownerName = leaderName;
        s.stored = eu;
        return s;
    }

    private static String ownerName(UUID player, Map<UUID, String> known, MinecraftServer server) {
        String name = known.get(player);
        if (name != null) return name;
        GameProfile profile = server.func_152358_ax()
            .func_152652_a(player);
        return profile == null ? null : profile.getName();
    }
}
