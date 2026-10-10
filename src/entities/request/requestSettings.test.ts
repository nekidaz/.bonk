import { describe, expect, it } from 'vitest';
import { compactOverrides, withOverrides } from './requestSettings';
import type { RequestSettings } from '$shared/model';

const base: RequestSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  validateTls: true,
  maxResponseBodyBytes: 1,
  proxy: { mode: 'system', url: '', bypass: '', username: '', password: '' },
  caPaths: [],
  trustSystemCas: true,
  clientCerts: [],
  cookieJar: '',
  cookiesSave: true,
  cookiesSend: true,
  cookiesKeepSession: false,
  cookiesExclude: [],
};

describe('withOverrides', () => {
  it('keeps the global value for anything unset', () => {
    expect(withOverrides(base, undefined)).toBe(base);
    expect(withOverrides(base, {})).toEqual(base);
  });
  it('applies timeout / redirects / TLS and ignores a bad timeout', () => {
    expect(withOverrides(base, { timeoutMs: 5000, followRedirects: false, validateTls: false })).toMatchObject({
      timeoutMs: 5000,
      followRedirects: false,
      validateTls: false,
    });
    expect(withOverrides(base, { timeoutMs: 0 }).timeoutMs).toBe(0);
    expect(withOverrides(base, { timeoutMs: -1 }).timeoutMs).toBe(30_000);
    expect(withOverrides(base, { timeoutMs: NaN }).timeoutMs).toBe(30_000);
  });
  it('compactOverrides drops unset fields', () => {
    expect(compactOverrides({ timeoutMs: undefined, validateTls: false })).toEqual({ validateTls: false });
    expect(compactOverrides({ followRedirects: undefined })).toBeUndefined();
  });
});
