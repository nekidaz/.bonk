import type { SessionTone } from '$shared/model';

/** What a row of the Sessions dialog offers for a session in this state. */
export function sessionRowActions(tone: SessionTone): { refresh: boolean; signIn: boolean; signOut: boolean } {
  return {
    refresh: tone === 'ok' || tone === 'renew',
    signIn: tone === 'dead' || tone === 'none',
    // A dead session is replaced by “Sign in” (or dropped by “Sign out everywhere”).
    signOut: tone === 'ok' || tone === 'renew',
  };
}
