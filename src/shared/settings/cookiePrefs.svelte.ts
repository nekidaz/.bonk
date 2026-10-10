// Settings → Cookies (Flow · Cookies CJ6): self-persisting switches of the cookie jar.
import { isArrayOf, persisted } from '$shared/persist';

export type CookieJarScope = 'workspace' | 'app';

const isScope = (v: unknown): v is CookieJarScope => v === 'workspace' || v === 'app';
const isString = (v: unknown): v is string => typeof v === 'string';

/** Store Set-Cookie from responses. */
export const cookiesSave = persisted('cookiesSave', true);
/** Send matching jar cookies with requests. */
export const cookiesSend = persisted('cookiesSend', true);
/** Keep session cookies across restarts too. */
export const cookiesKeepSession = persisted('cookiesKeepSession', false);
/** Whose jar: one per workspace, or one for the whole app. */
export const cookieJarScope = persisted<CookieJarScope>('cookieJarScope', 'workspace', isScope);
/** Domains never stored nor sent (`sentry.io`, `*.doubleclick.net`). */
export const cookiesExclude = persisted<string[]>('cookiesExclude', [], isArrayOf(isString));
