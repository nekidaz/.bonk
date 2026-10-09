import { describe, expect, it } from 'vitest';
import { envShortcutTargets, paletteSlot, searchEnvironments, envColor, envTone, isProtected, historyDay, historyPath, needsProductionGuard, pushRecent, recentRequests, searchRequests, timeAgo } from './palette';
import type { TreeNode } from './types';

const req = (name: string, url: string, method = 'GET'): TreeNode => ({
  kind: 'request', id: `fs:${name}`, name, protocol: 'http', request: { method, url, headers: {}, body: '' },
});
const tree: TreeNode[] = [
  { kind: 'folder', id: 'fs:pay', name: 'Payments API', expanded: false, children: [req('List payments', '{{baseUrl}}/v1/payments'), req('Refund', '/refund', 'DELETE')] },
  req('Health', '/health'),
];

describe('searchRequests', () => {
  it('matches name, url and folder, keeping the folder name', () => {
    expect(searchRequests(tree, 'payments').map((r) => [r.node.name, r.folder])).toEqual([['List payments', 'Payments API'], ['Refund', 'Payments API']]);
    expect(searchRequests(tree, 'HEALTH').map((r) => r.folder)).toEqual(['']);
  });
  it('returns everything up to the limit for a blank query', () => {
    expect(searchRequests(tree, ' ')).toHaveLength(3);
    expect(searchRequests(tree, '', 2)).toHaveLength(2);
  });
});

describe('needsProductionGuard', () => {
  it('guards unsafe methods in production only', () => {
    expect(needsProductionGuard('delete', { name: 'Production' })).toBe(true);
    expect(needsProductionGuard('POST', { name: 'EU · prod' })).toBe(true);
    expect(needsProductionGuard('GET', { name: 'Production' })).toBe(false);
    expect(needsProductionGuard('DELETE', { name: 'Staging' })).toBe(false);
    expect(needsProductionGuard('DELETE', undefined)).toBe(false);
  });
  it('explicit protected flag overrides the name', () => {
    expect(needsProductionGuard('POST', { name: 'Staging', protected: true })).toBe(true);
    expect(needsProductionGuard('POST', { name: 'Production', protected: false })).toBe(false);
    expect(isProtected({ name: 'prod-eu' })).toBe(true);
  });
  it('envColor prefers the chosen swatch, else the name tone', () => {
    expect(envColor({ name: 'Production' })).toBe('red');
    expect(envColor({ name: 'Local' })).toBe('green');
    expect(envColor({ name: 'Production', color: 'blue' })).toBe('blue');
    expect(envColor({ name: 'QA', color: 'bogus' })).toBe('gray');
  });
});

describe('envTone / pushRecent', () => {
  it('derives the tone from the name', () => {
    expect(['Production', 'EU · Staging', 'Local', 'Dev', 'QA', 'Preprod'].map(envTone)).toEqual(['production', 'staging', 'local', 'local', 'other', 'production']);
  });
  it('keeps the newest three, without duplicates', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b']);
  });
});

describe('timeAgo / recentRequests', () => {
  it('formats short relative times', () => {
    // Local afternoon: timeAgo counts calendar days, so a UTC-midnight anchor flips «1 ч» to «вчера» in UTC.
    const now = new Date(1970, 0, 11, 14, 0).getTime();
    expect([now, now - 120_000, now - 3_600_000, now - 30 * 3_600_000, now - 3 * 86_400_000].map((t) => timeAgo(t, now))).toEqual(['сейчас', '2 мин', '1 ч', 'вчера', '3 дн']);
  });
  it('names history entries after saved requests and drops repeats', () => {
    const h = (url: string, at: number, method = 'GET', status = 200) => ({ id: String(at), protocol: 'http' as const, request: { method, url, headers: {} }, status, at });
    const rows = recentRequests([h('{{baseUrl}}/v1/payments', 3), h('{{baseUrl}}/v1/payments', 2), h('https://x.io/a/b', 1, 'POST', 500)], tree);
    expect(rows.map((r) => [r.method, r.name, r.folder, r.status, r.ok])).toEqual([['GET', 'List payments', 'Payments API', '200', true], ['POST', '/a/b', '', '500', false]]);
  });
});

describe('history rows', () => {
  it('groups by day and shortens targets', () => {
    const now = new Date(2026, 9, 8, 14, 0).getTime();
    expect([historyDay(now - 3_600_000, now), historyDay(now - 24 * 3_600_000, now)]).toEqual(['Сегодня', 'Вчера']);
    const h = (url: string) => ({ id: '1', protocol: 'http' as const, request: { method: 'GET', url, headers: {} }, status: 200, at: now });
    expect([historyPath(h('{{baseUrl}}/v1/payments?limit=20')), historyPath(h('https://api.x.io/v1/a')), historyPath(h('/raw'))]).toEqual(['/v1/payments', '/v1/a', '/raw']);
    expect(historyPath({ ...h(''), protocol: 'grpc', grpc: { endpoint: 'h', method: 'helloworld.Greeter.SayHello', plaintext: true, message: '', metadata: {} } })).toBe('Greeter/SayHello');
  });
});

describe('palette groups', () => {
  it('searchEnvironments is empty for a blank query and matches by name', () => {
    const envs = [{ name: 'Production' }, { name: 'Staging' }, { name: 'prod-eu' }];
    expect(searchEnvironments(envs, ' ')).toEqual([]);
    expect(searchEnvironments(envs, 'PROD').map((e) => e.name)).toEqual(['Production', 'prod-eu']);
    expect(searchEnvironments(envs, 'o', 1)).toHaveLength(1);
  });
  it('paletteSlot maps the flat index across requests, environments and commands', () => {
    const n = { requests: 2, envs: 1, commands: 2 };
    expect([0, 1, 2, 3, 4].map((i) => paletteSlot(i, n))).toEqual([
      { group: 'request', index: 0 }, { group: 'request', index: 1 }, { group: 'env', index: 0 },
      { group: 'command', index: 0 }, { group: 'command', index: 1 },
    ]);
    expect([paletteSlot(5, n), paletteSlot(-1, n)]).toEqual([undefined, undefined]);
  });
});

describe('envShortcutTargets', () => {
  it('numbers recents first, then the remaining envs, capped at nine', () => {
    const e = (id: string) => ({ id });
    expect(envShortcutTargets([e('b'), e('a')], [e('a'), e('b'), e('c')]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    const many = Array.from({ length: 12 }, (_, i) => e(String(i)));
    expect(envShortcutTargets([], many)).toHaveLength(9);
  });
});
