// Pure helpers of the cookie jar (Flow · Cookies): grouping by domain, expiry labels,
// building a Set-Cookie from the edit form.
import type { CookieChange, CookieInfo, ResponseCookie } from '$shared/model';

export interface DomainGroup {
  domain: string;
  count: number;
  /** localhost / an IP: drawn with a computer icon, kept by “Keep localhost cookies”. */
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

/** An i18n key (+ params) for the “Expires” column: Session · in 28 min · in 2 h · in 30 d · 12.10.2027 · expired. */
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
  /** “In…” in the expiry picker: Max-Age seconds, sent instead of Expires. */
  maxAge?: number | null;
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
  if (d.maxAge != null) parts.push(`Max-Age=${d.maxAge}`);
  else if (d.expiresMs != null) parts.push(`Expires=${new Date(d.expiresMs).toUTCString()}`);
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

/**
 * The cookies a request to `url` carries (`pm.cookies`): unexpired jar cookies whose domain, path
 * and Secure flag fit the URL, after applying `response` Set-Cookies (the jar list may not have
 * been re-read yet when a test script runs).
 */
export function cookiesFor(
  list: CookieInfo[],
  url: string,
  response: ResponseCookie[] = [],
): { name: string; value: string }[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const host = u.hostname.toLowerCase();
  let jar = list;
  for (const r of response) {
    if (r.change === 'new' || r.change === 'updated' || r.change === 'deleted') {
      jar = jar.filter((c) => !sameCookie(c, r));
      if (r.change !== 'deleted') jar = [...jar, r];
    }
  }
  const pathFits = (p: string) => p === '/' || u.pathname === p || u.pathname.startsWith(p.endsWith('/') ? p : `${p}/`);
  return jar
    .filter(
      (c) =>
        !c.expired &&
        (host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`))) &&
        pathFits(c.path) &&
        (!c.secure || u.protocol === 'https:'),
    )
    .map((c) => ({ name: c.name, value: c.value }));
}

/** One cell of the expiry picker's month (Monday first). */
export interface DayCell {
  year: number;
  /** 0-based, as in Date. */
  month: number;
  day: number;
  inMonth: boolean;
}

/** The weeks showing `month` of `year`, Monday first, padded with the neighbours' days. */
export function monthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(year, month, 1 - lead + i);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

/** Whole days, hours and minutes from `now` to `ms` (0 when past). */
export function spanParts(ms: number, now: number): { d: number; h: number; m: number } {
  const min = Math.max(0, Math.round((ms - now) / 60_000));
  return { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60), m: min % 60 };
}

/** «Almaty · UTC+5»: the system time zone the picker's time is in. */
export function zoneLabel(at = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const city = zone.split('/').at(-1)?.replace(/_/g, ' ') ?? '';
  const off = -at.getTimezoneOffset();
  const sign = off < 0 ? '−' : '+';
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  const utc = `UTC${off === 0 ? '' : `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`}`;
  return city ? `${city} · ${utc}` : utc;
}
