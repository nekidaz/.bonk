import { describe, expect, it } from 'vitest';
import { switchedProtocol, tabsToClose, togglePinned } from './tab';
import type { Tab } from '$shared/model';

const tabs = (...ids: string[]): Tab[] => ids.map((id) => ({ id, pinned: id.startsWith('p') }) as Tab);
const ids = (list: Tab[]) => list.map((t) => t.id);

describe('tab pinning (S17b)', () => {
  it('moves a pinned tab to the front, after the other pinned ones', () => {
    expect(ids(togglePinned(tabs('p1', 'a', 'b', 'c'), 'c'))).toEqual(['p1', 'c', 'a', 'b']);
    expect(ids(togglePinned(tabs('p1', 'p2', 'a'), 'p1'))).toEqual(['p2', 'p1', 'a']);
  });
  it('never closes pinned tabs', () => {
    const list = tabs('p1', 'a', 'b', 'c');
    expect(tabsToClose(list, 'b', 'others')).toEqual(['a', 'c']);
    expect(tabsToClose(list, 'a', 'right')).toEqual(['b', 'c']);
    expect(tabsToClose(list, 'p1', 'right')).toEqual(['a', 'b', 'c']);
    expect(tabsToClose(list, '', 'all')).toEqual(['a', 'b', 'c']);
    expect(tabsToClose(list, 'nope', 'right')).toEqual([]);
  });
});

describe('protocol switch (P3/P4)', () => {
  it('starts an empty unsaved request of the new type in the same tab', () => {
    const http = {
      id: 't1',
      protocol: 'http',
      title: 'List payments',
      manualTitle: true,
      savedPath: 'api/list',
      pinned: true,
      request: { method: 'POST', url: 'https://x', headers: { a: '1' }, body: '{}' },
    } as Tab;
    const grpc = switchedProtocol(http, 'grpc');
    expect(grpc).toMatchObject({
      id: 't1',
      protocol: 'grpc',
      pinned: true,
      manualTitle: false,
      grpc: { endpoint: '', message: '' },
    });
    expect(grpc.savedPath).toBeUndefined();
    expect(switchedProtocol(grpc, 'http')).toMatchObject({
      id: 't1',
      protocol: 'http',
      request: { method: 'GET', url: '' },
    });
  });
});
