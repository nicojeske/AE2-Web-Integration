package pl.kuba6000.ae2webintegration.core.http.contract;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Binds a URL query parameter to a typed request field. Required unless the field is also
 * {@link OptionalInput}, in which case an absent parameter leaves the field's initial value.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface QueryParam {

    String value();
}
