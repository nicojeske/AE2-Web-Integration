package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.Arrays;
import java.util.List;

import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;

/**
 * Minimal {@link IStackList}/{@link IAEGenericStack}/{@link IAEKey} fakes for {@code ItemHistoryStore}
 * tests - only what {@code ItemHistoryStore.sample} actually touches. Shared by more than one test class,
 * same reasoning {@code TestGridFixtures} gives for its own single copy.
 */
final class TrackingTestFakes {

    private TrackingTestFakes() {}

    static IAEGenericStack stack(String itemid, long amount) {
        IAEKey key = new IAEKey() {

            @Override
            public String web$getItemID() {
                return itemid;
            }

            @Override
            public String web$getDisplayName() {
                return itemid;
            }

            @Override
            public boolean web$isCraftable(IAEGrid grid) {
                return false;
            }

            @Override
            public boolean web$isSameType(IAEKey other) {
                return other != null && itemid.equals(other.web$getItemID());
            }
        };
        return new IAEGenericStack() {

            @Override
            public IAEKey web$what() {
                return key;
            }

            @Override
            public long web$amount() {
                return amount;
            }

            @Override
            public IAEGenericStack web$copy() {
                return this;
            }
        };
    }

    static IStackList stackList(IAEGenericStack... stacks) {
        List<IAEGenericStack> list = Arrays.asList(stacks);
        return new IStackList() {

            @Override
            public long web$getAmount(IAEKey key) {
                long total = 0;
                for (IAEGenericStack stack : list) {
                    if (stack.web$what()
                        .web$isSameType(key)) {
                        total += stack.web$amount();
                    }
                }
                return total;
            }

            @Override
            public Iterable<IAEGenericStack> web$stacks() {
                return list;
            }
        };
    }
}
