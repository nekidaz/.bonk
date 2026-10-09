import { describe, expect, it } from 'vitest';
import { isParamChanged, isTabDirty } from './dirty';
import type { RequestNode, Tab } from './types';

const saved: RequestNode = { kind: 'request', id: 'fs:a.json', name: 'List', protocol: 'http', request: { method: 'GET', url: '/p?limit=20', headers: {} }, params: [{ key: 'limit', value: '20', description: '', enabled: true }] };
const tab = (patch: Partial<Tab> = {}): Tab => ({ id: 't', protocol: 'http', title: 'List', savedPath: saved.id, request: { method: 'GET', url: '/p?limit=20', headers: {}, body: '' }, params: [{ key: 'limit', value: '20', description: '', enabled: true }, { key: '', value: '', description: '', enabled: true }], ...patch });

describe('isTabDirty', () => {
  it('ignores empty values and the blank trailing row', () => {
    expect(isTabDirty(tab(), saved)).toBe(false);
    expect(isTabDirty(tab(), undefined)).toBe(false);
  });
  it('flags request, param and name changes', () => {
    expect(isTabDirty(tab({ request: { method: 'GET', url: '/p?limit=50', headers: {} } }), saved)).toBe(true);
    expect(isTabDirty(tab({ title: 'Other' }), saved)).toBe(true);
    const changed = tab({ params: [{ key: 'limit', value: '50', description: '', enabled: true }] });
    expect([isParamChanged(changed, saved, 0), isParamChanged(tab(), saved, 0), isParamChanged(tab(), saved, 1)]).toEqual([true, false, false]);
  });
});
