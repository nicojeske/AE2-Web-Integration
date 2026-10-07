package pl.kuba6000.ae2webintegration.ae2interface.mixins.AE2.implementations;

import org.jetbrains.annotations.NotNull;
import org.spongepowered.asm.mixin.Mixin;

import appeng.api.storage.data.IAEFluidStack;
import appeng.api.storage.data.IAEItemStack;
import appeng.api.storage.data.IAEStack;
import appeng.api.storage.data.IAEStackType;
import pl.kuba6000.ae2webintegration.ae2interface.legacy.LegacyItemIdentity;
import pl.kuba6000.ae2webintegration.ae2interface.util.StackIds;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;

@Mixin(IAEStack.class)
public interface AEStackMixin extends IAEStack, IAEGenericStack, IAEKey {

    @Override
    default @NotNull StableKey web$getKey() {
        return LegacyItemIdentity.encode(this);
    }

    @Override
    default @NotNull IAEKey web$copyIdentity() {
        return LegacyItemIdentity.copy(this);
    }

    @Override
    default @NotNull String web$getItemID() {
        if (this instanceof IAEItemStack) {
            return StackIds.itemId(((IAEItemStack) this).getItem(), ((IAEItemStack) this).getItemDamage());
        }
        if (this instanceof IAEFluidStack) {
            return StackIds.fluidId(((IAEFluidStack) this).getFluid());
        }
        IAEStackType<?> type = getStackType();
        return (type == null ? "unknown" : type.getId()) + ":" + getUnlocalizedName();
    }

    @Override
    default @NotNull String web$getDisplayName() {
        return getDisplayName();
    }

    @Override
    default @NotNull IAEKey web$what() {
        return (IAEKey) this;
    }

    @Override
    default long web$amount() {
        return getStackSize();
    }

    @Override
    default boolean web$isCraftable(IAEGrid grid) {
        return isCraftable();
    }

}
