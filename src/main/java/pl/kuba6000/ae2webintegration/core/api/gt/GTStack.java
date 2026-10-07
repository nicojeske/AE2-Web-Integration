package pl.kuba6000.ae2webintegration.core.api.gt;

/**
 * An item or fluid amount. {@link #id} uses the same format as the AE2 side
 * ({@code IAEKey.web$getItemID()}): {@code modid:name:damage} for items and the fluid registry name for
 * fluids, so GregTech data and AE2 item history line up on the same key.
 */
public class GTStack {

    public String id;
    public String name;
    /** Items for items, millibuckets (L) for fluids. */
    public long amount;
    public boolean fluid;

    public GTStack() {}

    public GTStack(String id, String name, long amount, boolean fluid) {
        this.id = id;
        this.name = name;
        this.amount = amount;
        this.fluid = fluid;
    }
}
