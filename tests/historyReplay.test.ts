import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { openHistoryEntry, tabs, activeTabId } from '../src/lib/stores';
import type { HistoryEntry } from '../src/lib/domain/types';

describe('openHistoryEntry', () => {
  it('opens an http entry in a new active tab with its request restored', () => {
    const before = get(tabs).length;
    const entry: HistoryEntry = {
      id: 'h1',
      protocol: 'http',
      request: { method: 'POST', url: 'https://api.example.com/x', headers: { 'X-A': '1' }, body: '{"a":1}' },
      status: 200,
      at: 1,
    };
    openHistoryEntry(entry);
    const list = get(tabs);
    expect(list.length).toBe(before + 1);
    const tab = list[list.length - 1];
    expect(get(activeTabId)).toBe(tab.id);
    expect(tab.protocol).toBe('http');
    expect(tab.request.method).toBe('POST');
    expect(tab.request.url).toBe('https://api.example.com/x');
    expect(tab.request.body).toBe('{"a":1}');
    // headers are copied, not shared with the entry
    expect(tab.request.headers).toEqual({ 'X-A': '1' });
    expect(tab.request.headers).not.toBe(entry.request.headers);
    // a replayed tab is not linked to a saved request
    expect(tab.savedPath).toBeUndefined();
  });

  it('opens a grpc entry and drops the stale connectionId/tree', () => {
    const entry: HistoryEntry = {
      id: 'h2',
      protocol: 'grpc',
      request: { method: 'GRPC', url: 'localhost:50051 pkg.Svc.M', headers: {} },
      status: 0,
      ok: true,
      grpc: {
        endpoint: 'localhost:50051',
        plaintext: true,
        connectionId: 'dead-conn',
        tree: { services: [] },
        method: 'pkg.Svc.M',
        message: '{"x":1}',
        metadata: { authorization: 'Bearer t' },
      },
      at: 2,
    };
    openHistoryEntry(entry);
    const tab = get(tabs).at(-1)!;
    expect(tab.protocol).toBe('grpc');
    expect(tab.grpc?.endpoint).toBe('localhost:50051');
    expect(tab.grpc?.method).toBe('pkg.Svc.M');
    expect(tab.grpc?.message).toBe('{"x":1}');
    expect(tab.grpc?.connectionId).toBeUndefined();
    expect(tab.grpc?.tree).toBeUndefined();
  });
});
