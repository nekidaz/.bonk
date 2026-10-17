// Settings → Variables (Flow · Dynamic variables, DV5): how {{$dynamic}} values are generated.
import { setting } from '$shared/persist';
import type { DynamicOptions } from '$shared/model';

const isLocale = (v: unknown): v is DynamicOptions['locale'] => v === 'ru' || v === 'en';

/** Language of names, addresses and phones. */
export const dynLocale = setting<DynamicOptions['locale']>('variables.dynamic.locale', 'dynLocale', 'ru', isLocale);
/** `{{$guid}}` in a header and in the body is the same value. */
export const dynPerRequest = setting('variables.dynamic.perRequest', 'dynPerRequest', true);
/** Keep the request as sent (with its values) for the response's Timeline. */
export const dynKeepSent = setting('variables.dynamic.keepSent', 'dynKeepSent', true);
/** A fixed seed: the same «random» values every time. */
export const dynSeedOn = setting('variables.dynamic.fixedSeed', 'dynSeedOn', false);
export const dynSeed = setting('variables.dynamic.seed', 'dynSeed', 42);

/** What Rust generates with (`DynamicOptions` in domain/dynamic_vars.rs). */
export function dynamicOptions(): DynamicOptions {
  return {
    locale: dynLocale.current,
    perRequest: dynPerRequest.current,
    seed: dynSeedOn.current ? Math.max(0, Math.round(dynSeed.current)) : null,
  };
}
