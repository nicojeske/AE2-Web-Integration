package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.Arrays;
import java.util.List;

import pl.kuba6000.ae2webintegration.core.identity.StableKey;
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
        return stack(itemid, amount, itemid);
    }

    /**
     * Same as {@link #stack(String, long)}, but with a display name distinct from the itemid - needed
     * to tell "captured the display name" apart from "captured the itemid" in a name-capture test.
     */
    static IAEGenericStack stack(String itemid, long amount, String displayName) {
        StableKey identity = StableKey.create(sink -> StableKey.writeText(sink, itemid));
        IAEKey key = new IAEKey() {

            @Override
            public StableKey web$getKey() {
                return identity;
            }

            @Override
            public IAEKey web$copyIdentity() {
                return this;
            }

            @Override
            public String web$getItemID() {
                return itemid;
            }

            @Override
            public String web$getDisplayName() {
                return displayName;
            }

            @Override
            public boolean web$isCraftable(IAEGrid grid) {
                return false;
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
                        .web$getKey()
                        .equals(key.web$getKey())) {
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
