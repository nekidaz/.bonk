import type { RequestOverrides, RequestSettings } from '$shared/model';

/** Global settings with a request's own overrides applied on top; unset or invalid fields keep the global value. */
export function withOverrides(base: RequestSettings, o: RequestOverrides | undefined): RequestSettings {
  if (!o) return base;
  const t = o.timeoutMs;
  return {
    ...base,
    timeoutMs:
      typeof t === 'number' && Number.isFinite(t) && t >= 0 ? Math.min(600_000, Math.round(t)) : base.timeoutMs,
    followRedirects: o.followRedirects ?? base.followRedirects,
    validateTls: o.validateTls ?? base.validateTls,
  };
}

/** Drop empty overrides so a fully reset request carries no `settings`. */
export function compactOverrides(o: RequestOverrides): RequestOverrides | undefined {
  const out: RequestOverrides = {};
  if (o.timeoutMs !== undefined) out.timeoutMs = o.timeoutMs;
  if (o.followRedirects !== undefined) out.followRedirects = o.followRedirects;
  if (o.validateTls !== undefined) out.validateTls = o.validateTls;
  return Object.keys(out).length ? out : undefined;
}
