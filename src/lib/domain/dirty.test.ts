import { describe, expect, it } from 'vitest';
import { isParamChanged, isScratchDirty, isTabDirty } from './dirty';
import type { RequestNode, Tab } from './types';

const saved: RequestNode = {
  kind: 'request',
  id: 'fs:a.json',
  name: 'List',
  protocol: 'http',
  request: { method: 'GET', url: '/p?limit=20', headers: {} },
  params: [{ key: 'limit', value: '20', description: '', enabled: true }],
};
const tab = (patch: Partial<Tab> = {}): Tab => ({
  id: 't',
  protocol: 'http',
  title: 'List',
  savedPath: saved.id,
  request: { method: 'GET', url: '/p?limit=20', headers: {}, body: '' },
  params: [
    { key: 'limit', value: '20', description: '', enabled: true },
    { key: '', value: '', description: '', enabled: true },
  ],
  ...patch,
});

describe('isTabDirty', () => {
  it('ignores empty values and the blank trailing row', () => {
    expect(isTabDirty(tab(), saved)).toBe(false);
    expect(isTabDirty(tab(), undefined)).toBe(false);
  });
  it('flags request, param and name changes', () => {
    expect(isTabDirty(tab({ request: { method: 'GET', url: '/p?limit=50', headers: {} } }), saved)).toBe(true);
    expect(isTabDirty(tab({ title: 'Other' }), saved)).toBe(true);
    const changed = tab({ params: [{ key: 'limit', value: '50', description: '', enabled: true }] });
    expect([
      isParamChanged(changed, saved, 0),
      isParamChanged(tab(), saved, 0),
      isParamChanged(tab(), saved, 1),
    ]).toEqual([true, false, false]);
  });
});

describe('isScratchDirty', () => {
  const scratch = (request: Tab['request'], patch: Partial<Tab> = {}): Tab => ({
    id: 's',
    protocol: 'http',
    title: 'New',
    request,
    ...patch,
  });
  it('ignores a blank tab and picker defaults', () => {
    expect(
      isScratchDirty(
        scratch({ method: 'POST', url: '', headers: {}, body: '', bodyMode: 'raw', auth: { type: 'none' } }),
      ),
    ).toBe(false);
    expect(isScratchDirty(tab())).toBe(false); // saved tabs go through isTabDirty
  });
  it('flags typed content', () => {
    expect(isScratchDirty(scratch({ method: 'GET', url: 'https://x', headers: {} }))).toBe(true);
    expect(
      isScratchDirty(scratch({ method: 'GET', url: '', headers: {}, auth: { type: 'bearer', bearerToken: 't' } })),
    ).toBe(true);
    expect(
      isScratchDirty({
        id: 'g',
        protocol: 'grpc',
        title: 'g',
        request: { method: 'GRPC', url: '', headers: {} },
        grpc: { endpoint: 'localhost:50051', plaintext: true, message: '', metadata: {} },
      }),
    ).toBe(true);
  });
});
