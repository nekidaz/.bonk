import { describe, expect, it } from 'vitest';
import { compactOverrides, withOverrides } from './requestSettings';
import { revertedTab } from './dirty';
import type { RequestNode, RequestSettings, Tab } from './types';

const base: RequestSettings = {
  timeoutMs: 30_000, followRedirects: true, validateTls: true, maxResponseBodyBytes: 1,
  proxy: { mode: 'system', url: '', bypass: '', username: '', password: '' }, caPaths: [], trustSystemCas: true, clientCerts: [],
};

describe('withOverrides', () => {
  it('keeps the global value for anything unset', () => {
    expect(withOverrides(base, undefined)).toBe(base);
    expect(withOverrides(base, {})).toEqual(base);
  });
  it('applies timeout / redirects / TLS and ignores a bad timeout', () => {
    expect(withOverrides(base, { timeoutMs: 5000, followRedirects: false, validateTls: false })).toMatchObject({ timeoutMs: 5000, followRedirects: false, validateTls: false });
    expect(withOverrides(base, { timeoutMs: 0 }).timeoutMs).toBe(0);
    expect(withOverrides(base, { timeoutMs: -1 }).timeoutMs).toBe(30_000);
    expect(withOverrides(base, { timeoutMs: NaN }).timeoutMs).toBe(30_000);
  });
  it('compactOverrides drops unset fields', () => {
    expect(compactOverrides({ timeoutMs: undefined, validateTls: false })).toEqual({ validateTls: false });
    expect(compactOverrides({ followRedirects: undefined })).toBeUndefined();
  });
});

describe('revertedTab', () => {
  const saved: RequestNode = { kind: 'request', id: 'fs:a.json', name: 'List', protocol: 'http', request: { method: 'GET', url: '/p', headers: { a: '1' } }, params: [{ key: 'k', value: 'v', description: '', enabled: true }] };
  const tab: Tab = { id: 't', protocol: 'http', title: 'Renamed', savedPath: saved.id, request: { method: 'POST', url: '/x', headers: {} }, params: [], settings: { validateTls: false } };
  it('puts the saved content back and keeps tab identity and overrides', () => {
    const r = revertedTab(tab, saved, '/ws');
    expect(r).toMatchObject({ id: 't', title: 'List', savedPath: saved.id, request: saved.request, params: saved.params, settings: { validateTls: false } });
    expect(r.request).not.toBe(saved.request);
  });
});
