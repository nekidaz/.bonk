// Settings → Variables (Flow · Динамические переменные, DV5): how {{$dynamic}} values are generated.
import { persisted } from '$shared/persist';
import type { DynamicOptions } from '$shared/model';

const isLocale = (v: unknown): v is DynamicOptions['locale'] => v === 'ru' || v === 'en';

/** Language of names, addresses and phones. */
export const dynLocale = persisted<DynamicOptions['locale']>('dynLocale', 'ru', isLocale);
/** `{{$guid}}` in a header and in the body is the same value. */
export const dynPerRequest = persisted('dynPerRequest', true);
/** Keep the request as sent (with its values) for the response's Timeline. */
export const dynKeepSent = persisted('dynKeepSent', true);
/** A fixed seed: the same «random» values every time. */
export const dynSeedOn = persisted('dynSeedOn', false);
export const dynSeed = persisted('dynSeed', 42);

/** What Rust generates with (`DynamicOptions` in domain/dynamic_vars.rs). */
export function dynamicOptions(): DynamicOptions {
  return {
    locale: dynLocale.current,
    perRequest: dynPerRequest.current,
    seed: dynSeedOn.current ? Math.max(0, Math.round(dynSeed.current)) : null,
  };
}
