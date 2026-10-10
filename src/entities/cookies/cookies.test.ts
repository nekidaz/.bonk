import { describe, expect, it } from 'vitest';
import type { CookieInfo, ResponseCookie } from '$shared/model';
import {
  changeCounts,
  cookieUrl,
  domainGroups,
  draftOf,
  emptyDraft,
  expiryLabel,
  pastedDomain,
  setCookieOf,
} from './cookies';

const cookie = (p: Partial<CookieInfo>): CookieInfo => ({
  name: 'sid',
  value: '1',
  domain: 'api.a.kz',
  hostOnly: true,
  path: '/',
  expiresMs: null,
  expired: false,
  httpOnly: false,
  secure: false,
  sameSite: null,
  raw: 'sid=1',
  ...p,
});

describe('domainGroups', () => {
  const list = [
    cookie({ domain: 'api.a.kz', name: 'sid' }),
    cookie({ domain: 'api.a.kz', name: 'csrf' }),
    cookie({ domain: 'localhost', name: 'dev' }),
  ];
  it('counts per domain in jar order and marks local hosts', () => {
    expect(domainGroups(list)).toEqual([
      { domain: 'api.a.kz', count: 2, local: false },
      { domain: 'localhost', count: 1, local: true },
    ]);
  });
  it('filters by domain or cookie name', () => {
    expect(domainGroups(list, 'CSRF')).toEqual([{ domain: 'api.a.kz', count: 1, local: false }]);
    expect(domainGroups(list, 'local').map((g) => g.domain)).toEqual(['localhost']);
  });
});

describe('expiryLabel', () => {
  const now = Date.UTC(2026, 9, 11, 12, 0);
  const at = (ms: number) => expiryLabel({ expiresMs: now + ms, expired: false }, now);
  it('picks the unit by distance', () => {
    expect(expiryLabel({ expiresMs: null, expired: false }, now).key).toBe('cookies.exp.session');
    expect(expiryLabel({ expiresMs: now - 1, expired: true }, now).key).toBe('cookies.exp.expired');
    expect(at(28 * 60_000)).toEqual({ key: 'cookies.exp.min', params: { n: 28 } });
    expect(at(2 * 3600_000)).toEqual({ key: 'cookies.exp.h', params: { n: 2 } });
    expect(at(30 * 86400_000)).toEqual({ key: 'cookies.exp.d', params: { n: 30 } });
    expect(at(366 * 86400_000)).toEqual({ key: 'cookies.exp.date', params: { date: '12.10.2027' } });
  });
});

describe('setCookieOf', () => {
  it('round-trips a jar cookie into a Set-Cookie value', () => {
    const d = draftOf(
      cookie({
        domain: 'a.kz',
        hostOnly: false,
        path: '/v1',
        expiresMs: Date.UTC(2100, 7, 3),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      }),
    );
    expect(d.sameSite).toBe('Lax');
    expect(setCookieOf(d)).toBe(
      'sid=1; Domain=a.kz; Path=/v1; Expires=Tue, 03 Aug 2100 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    );
  });
  it('a new host-only session cookie has no Domain and no Expires', () => {
    expect(setCookieOf({ ...emptyDraft('a.kz'), name: ' x ', value: 'y', path: '' })).toBe('x=y; Path=/; SameSite=Lax');
  });
});

describe('cookieUrl / pastedDomain', () => {
  it('builds the store URL', () => {
    expect(cookieUrl('a.kz', 'v1')).toBe('https://a.kz/v1');
    expect(cookieUrl(' a.kz ')).toBe('https://a.kz/');
  });
  it('takes the Domain attribute of a pasted cookie, else the fallback', () => {
    expect(pastedDomain('x=1; Path=/; Domain=.b.kz; Secure', 'a.kz')).toBe('b.kz');
    expect(pastedDomain('x=1; Path=/', 'a.kz')).toBe('a.kz');
  });
});

describe('changeCounts', () => {
  it('counts each change, ignoring cookies the jar did not see', () => {
    const rc = (change: ResponseCookie['change']): ResponseCookie => ({ ...cookie({}), change });
    expect(changeCounts([rc('new'), rc('new'), rc('deleted'), rc(null)])).toEqual({
      new: 2,
      updated: 0,
      deleted: 1,
      rejected: 0,
    });
  });
});
