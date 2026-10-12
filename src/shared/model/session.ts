import type { SessionConfig, SessionInfo } from './types';

/**
 * What a stored session is worth right now (unix seconds).
 * `ok`: the access token is good. `renew`: it is not, but the refresh token can still be
 * traded (the next send does it by itself). `dead`: nothing left to renew with, signing in
 * again is the only way. `none`: no session at all.
 */
export type SessionTone = 'ok' | 'renew' | 'dead' | 'none';

export function sessionTone(info: SessionInfo | null | undefined, now: number): SessionTone {
  if (!info) return 'none';
  if (info.accessExp === null || now < info.accessExp) return 'ok';
  const refreshAlive = info.hasRefresh && (info.refreshExp === null || now < info.refreshExp);
  return refreshAlive ? 'renew' : 'dead';
}

/** The settings are complete enough to sign in (mirrors `SessionConfig::check`). */
export function sessionConfigured(config: SessionConfig | undefined): boolean {
  return !!config?.login?.trim() && !!config.access?.request?.trim() && !!config.access.path?.trim();
}

/** Renewing needs the request that trades the refresh token and a refresh token from the sign-in. */
export const sessionCanRenew = (config: SessionConfig | undefined): boolean =>
  !!config?.renewRequest?.trim() && !!config.refresh?.request?.trim();

/** `Verify OTP` from `fs:api/Auth/Verify OTP.bonk.json`. */
export function nodeName(id: string | undefined): string {
  const file = (id ?? '').split('/').pop() ?? '';
  return file.replace(/\.bonk\.json$/, '');
}
