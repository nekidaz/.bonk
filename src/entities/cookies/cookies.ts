// Pure helpers of the cookie jar (Flow · Cookies): grouping by domain, expiry labels,
// building a Set-Cookie from the edit form.
import type { CookieChange, CookieInfo, ResponseCookie } from '$shared/model';

export interface DomainGroup {
  domain: string;
  count: number;
  /** localhost / an IP: drawn with a computer icon, kept by «Оставить cookies localhost». */
  local: boolean;
}

export const isLocalDomain = (domain: string): boolean =>
  domain === 'localhost' || domain.endsWith('.localhost') || /^[\d.]+$/.test(domain) || domain.includes(':');

/** Domains of `list` in jar order with their cookie counts; `query` matches a domain or a cookie name. */
export function domainGroups(list: CookieInfo[], query = ''): DomainGroup[] {
  const q = query.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const c of list) {
    if (q && !c.domain.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) continue;
    counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1);
  }
  return [...counts].map(([domain, count]) => ({ domain, count, local: isLocalDomain(domain) }));
}

/** An i18n key (+ params) for the «Истекает» column: Сессия · через 28 мин · через 2 ч · через 30 дн · 12.10.2027 · истекла. */
export function expiryLabel(
  c: Pick<CookieInfo, 'expiresMs' | 'expired'>,
  now: number,
): { key: string; params?: Record<string, string | number> } {
  if (c.expired) return { key: 'cookies.exp.expired' };
  if (c.expiresMs == null) return { key: 'cookies.exp.session' };
  const min = Math.max(1, Math.round((c.expiresMs - now) / 60_000));
  if (min < 60) return { key: 'cookies.exp.min', params: { n: min } };
  const h = Math.round(min / 60);
  if (h < 48) return { key: 'cookies.exp.h', params: { n: h } };
  const d = Math.round(h / 24);
  if (d < 90) return { key: 'cookies.exp.d', params: { n: d } };
  const at = new Date(c.expiresMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    key: 'cookies.exp.date',
    params: { date: `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}` },
  };
}

export type SameSite = 'Strict' | 'Lax' | 'None';

/** The edit form of one cookie (CJ3). */
export interface CookieDraft {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix ms; null = session. */
  expiresMs: number | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite | null;
  /** No Domain attribute: only this exact host gets it. */
  hostOnly: boolean;
}

export function draftOf(c: CookieInfo): CookieDraft {
  const ss = c.sameSite ? c.sameSite[0].toUpperCase() + c.sameSite.slice(1).toLowerCase() : null;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expiresMs: c.expiresMs,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: ss === 'Strict' || ss === 'Lax' || ss === 'None' ? ss : null,
    hostOnly: c.hostOnly,
  };
}

export const emptyDraft = (domain: string): CookieDraft => ({
  name: '',
  value: '',
  domain,
  path: '/',
  expiresMs: null,
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
  hostOnly: true,
});

/** The draft as a Set-Cookie value (also the raw line under the form). */
export function setCookieOf(d: CookieDraft): string {
  const parts = [`${d.name.trim()}=${d.value}`];
  if (!d.hostOnly) parts.push(`Domain=${d.domain.trim()}`);
  parts.push(`Path=${d.path.trim() || '/'}`);
  if (d.expiresMs != null) parts.push(`Expires=${new Date(d.expiresMs).toUTCString()}`);
  if (d.httpOnly) parts.push('HttpOnly');
  if (d.secure) parts.push('Secure');
  if (d.sameSite) parts.push(`SameSite=${d.sameSite}`);
  return parts.join('; ');
}

/** The URL a cookie for `domain` is stored "from" (the jar checks Domain and Path against it). */
export function cookieUrl(domain: string, path = '/'): string {
  const p = path.trim() || '/';
  return `https://${domain.trim()}${p.startsWith('/') ? p : `/${p}`}`;
}

/** Domain of a pasted Set-Cookie: its Domain attribute, else `fallback` (the selected domain). */
export function pastedDomain(setCookie: string, fallback: string): string {
  const m = /;\s*domain\s*=\s*\.?([^;\s]+)/i.exec(setCookie);
  return m ? m[1] : fallback;
}

/** Same jar entry: name, domain and path identify a cookie. */
export const sameCookie = (
  a: Pick<CookieInfo, 'name' | 'domain' | 'path'>,
  b: Pick<CookieInfo, 'name' | 'domain' | 'path'>,
): boolean => a.name === b.name && a.domain === b.domain && a.path === b.path;

export function changeCounts(cookies: ResponseCookie[]): Record<CookieChange, number> {
  const out: Record<CookieChange, number> = { new: 0, updated: 0, deleted: 0, rejected: 0 };
  for (const c of cookies) if (c.change) out[c.change]++;
  return out;
}
