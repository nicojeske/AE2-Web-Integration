package pl.kuba6000.ae2webintegration.ae2interface.gt;

import pl.kuba6000.ae2webintegration.ae2interface.AE2WebIntegration;
import pl.kuba6000.ae2webintegration.core.api.IAEWebInterface;

/** The only entry point into GregTech code from always-loaded classes; call it only when GregTech is loaded. */
public final class GTCompat {

    private GTCompat() {}

    public static void init() {
        IAEWebInterface.getInstance()
            .registerGTProvider(new GTProvider());
        AE2WebIntegration.LOG.info("GregTech provider registered");
    }
}
