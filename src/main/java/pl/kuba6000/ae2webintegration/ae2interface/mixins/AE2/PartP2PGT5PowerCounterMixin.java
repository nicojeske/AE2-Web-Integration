package pl.kuba6000.ae2webintegration.ae2interface.mixins.AE2;

import net.minecraft.server.MinecraftServer;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import appeng.parts.p2p.PartP2PGT5Power;
import pl.kuba6000.ae2webintegration.ae2interface.accessors.IEnergyTunnelCounters;

/**
 * Counts what an EU P2P input moves. A GregTech cable hands the input {@code injectEnergyUnits(voltage, amps)}, the
 * tunnel passes the amps straight on to whatever its outputs face and returns how many were taken. When they take
 * every amp offered, demand has caught up with what the line delivers: that tick counts as maxed.
 */
@Mixin(value = PartP2PGT5Power.class, remap = false)
public abstract class PartP2PGT5PowerCounterMixin implements IEnergyTunnelCounters {

    @Unique
    private long web$euAccepted;
    @Unique
    private long web$packetsAccepted;
    @Unique
    private long web$ticksMaxed;
    @Unique
    private long web$voltage;
    @Unique
    private int web$lastMaxedTick = -1;

    @Inject(method = "injectEnergyUnits", at = @At("RETURN"))
    private void web$countInjected(long voltage, long amperage, CallbackInfoReturnable<Long> cir) {
        long used = cir.getReturnValue();
        if (used <= 0 || voltage <= 0) return;
        web$voltage = voltage;
        web$euAccepted += used * voltage;
        web$packetsAccepted += used;
        if (used >= amperage) {
            int tick = MinecraftServer.getServer()
                .getTickCounter();
            if (tick != web$lastMaxedTick) {
                web$lastMaxedTick = tick;
                web$ticksMaxed++;
            }
        }
    }

    @Override
    public long web$euAccepted() {
        return web$euAccepted;
    }

    @Override
    public long web$packetsAccepted() {
        return web$packetsAccepted;
    }

    @Override
    public long web$ticksMaxed() {
        return web$ticksMaxed;
    }

    @Override
    public long web$voltage() {
        return web$voltage;
    }
}
