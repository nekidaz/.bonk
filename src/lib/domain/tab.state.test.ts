import { describe, expect, it } from 'vitest';
import {
  HTTP_DEFAULT_TITLE,
  GRPC_DEFAULT_TITLE,
  titleFromUrl,
  relinkTabPaths,
  normalizeTabTitleState,
  moveTabTo,
} from './tab';
import type { Tab } from './types';

function httpTab(over: Partial<Tab> = {}): Tab {
  return {
    id: over.id ?? crypto.randomUUID(),
    protocol: 'http',
    title: 'Untitled request',
    request: { method: 'GET', url: '', headers: {} },
    ...over,
  };
}

describe('titleFromUrl', () => {
  it('uses the fallback for an empty/whitespace URL', () => {
    expect(titleFromUrl('', HTTP_DEFAULT_TITLE)).toBe('Untitled request');
    expect(titleFromUrl('   ', GRPC_DEFAULT_TITLE)).toBe('Untitled gRPC request');
  });

  it('derives the title from the last path segment', () => {
    expect(titleFromUrl('https://api.bonk.io/v1/users/123/profile')).toBe('profile');
  });

  it('falls back to the hostname when there is no path', () => {
    expect(titleFromUrl('https://api-preprod.example.com/')).toBe('api-preprod.example.com');
    expect(titleFromUrl('google.com')).toBe('google.com');
  });

  it('keeps an unparseable {{var}} template as the raw input rather than a stray segment', () => {
    // The space makes `new URL()` throw; the fallback sees a last segment ending
    // in `}}` and returns the cleaned input so an env-var template isn't mangled.
    expect(titleFromUrl('{{a}} {{b}}')).toBe('{{a}} {{b}}');
  });

  it('derives the path segment when a {{var}} URL still parses', () => {
    // `https://{{baseUrl}}/users` parses (host = template), so the last path
    // segment wins — auto-titles stay useful for templated requests.
    expect(titleFromUrl('{{baseUrl}}/users')).toBe('users');
  });
});

describe('relinkTabPaths', () => {
  it('clears savedPath on the exact match and nested children when toId is undefined (delete)', () => {
    const list = [
      httpTab({ id: 'a', savedPath: 'fs:API/Ping.bonk.json' }),
      httpTab({ id: 'b', savedPath: 'fs:API/Ping.bonk.json/nested' }),
      httpTab({ id: 'c', savedPath: 'fs:Other.bonk.json' }),
      httpTab({ id: 'd' }),
    ];
    const out = relinkTabPaths(list, 'fs:API/Ping.bonk.json', undefined);
    expect(out.find((t) => t.id === 'a')?.savedPath).toBeUndefined();
    expect(out.find((t) => t.id === 'b')?.savedPath).toBeUndefined();
    // unrelated paths and unsaved tabs are untouched
    expect(out.find((t) => t.id === 'c')?.savedPath).toBe('fs:Other.bonk.json');
    expect(out.find((t) => t.id === 'd')?.savedPath).toBeUndefined();
  });

  it('remaps the exact match and re-prefixes nested children to the new id (rename/move)', () => {
    const list = [
      httpTab({ id: 'a', savedPath: 'fs:API' }),
      httpTab({ id: 'b', savedPath: 'fs:API/Ping.bonk.json' }),
      httpTab({ id: 'c', savedPath: 'fs:APIv2.bonk.json' }),
    ];
    const out = relinkTabPaths(list, 'fs:API', 'fs:Backend');
    expect(out.find((t) => t.id === 'a')?.savedPath).toBe('fs:Backend');
    expect(out.find((t) => t.id === 'b')?.savedPath).toBe('fs:Backend/Ping.bonk.json');
    // `fs:APIv2...` shares a textual prefix but not the `fs:API/` boundary, so untouched
    expect(out.find((t) => t.id === 'c')?.savedPath).toBe('fs:APIv2.bonk.json');
  });

  it('does not mutate the input list', () => {
    const list = [httpTab({ id: 'a', savedPath: 'fs:X' })];
    const out = relinkTabPaths(list, 'fs:X', 'fs:Y');
    expect(list[0].savedPath).toBe('fs:X');
    expect(out[0].savedPath).toBe('fs:Y');
    expect(out[0]).not.toBe(list[0]);
  });
});

describe('normalizeTabTitleState', () => {
  it('leaves a tab whose manualTitle is already defined unchanged', () => {
    const tab = httpTab({ manualTitle: false, title: 'whatever' });
    expect(normalizeTabTitleState(tab)).toBe(tab);
  });

  it('infers manualTitle=true for a saved tab with no explicit flag', () => {
    const { manualTitle: _drop, ...rest } = httpTab({ savedPath: 'fs:API/Ping.bonk.json', title: 'Ping' });
    const out = normalizeTabTitleState(rest as Tab);
    expect(out.manualTitle).toBe(true);
    expect(out.title).toBe('Ping');
  });

  it('treats a legacy default title as auto and re-derives it from the URL', () => {
    const { manualTitle: _drop, ...rest } = httpTab({
      title: 'New Request',
      request: { method: 'GET', url: 'https://api.example.com/v1/orders', headers: {} },
    });
    const out = normalizeTabTitleState(rest as Tab);
    expect(out.manualTitle).toBe(false);
    expect(out.title).toBe('orders');
  });

  it('treats a custom title as manual and preserves it', () => {
    const { manualTitle: _drop, ...rest } = httpTab({
      title: 'My Custom Name',
      request: { method: 'GET', url: 'https://api.example.com/v1/orders', headers: {} },
    });
    const out = normalizeTabTitleState(rest as Tab);
    expect(out.manualTitle).toBe(true);
    expect(out.title).toBe('My Custom Name');
  });
});

describe('moveTabTo', () => {
  const ids = (list: Tab[]) => list.map((t) => t.id);
  const list = ['a', 'b', 'c'].map((id) => httpTab({ id }));
  it('moves a tab forward and backward', () => {
    expect(ids(moveTabTo(list, 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTabTo(list, 'c', 0))).toEqual(['c', 'a', 'b']);
  });
  it('returns the same list for an unknown id or the same slot', () => {
    expect(moveTabTo(list, 'x', 1)).toBe(list);
    expect(moveTabTo(list, 'b', 1)).toBe(list);
  });
});
