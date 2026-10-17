import { describe, expect, it } from 'vitest';
import type { IpcCall } from '$shared/ipc';
import { aggregateIpc, downsample, eventsFromCalls, peak, rate, Ring } from './series';

const call = (cmd: string, ms: number, at = 10_000, bytes = 0): IpcCall => ({ cmd, at, ms, bytes, ok: true });
const tr = (key: string) => key;

describe('Ring', () => {
  it('keeps the newest values up to its capacity', () => {
    const r = new Ring<number>(3);
    [1, 2, 3, 4].forEach((v) => r.push(v));
    expect(r.values()).toEqual([2, 3, 4]);
    expect(r.last()).toBe(4);
    expect(r.length).toBe(3);
    r.clear();
    expect(r.values()).toEqual([]);
  });
});

describe('downsample', () => {
  it('keeps each bucket peak', () => {
    expect(downsample([1, 9, 2, 3, 8, 1], 3)).toEqual([9, 3, 8]);
    expect(downsample([1, 2], 10)).toEqual([1, 2]);
  });
});

describe('peak', () => {
  it('finds the max and when it happened', () => {
    expect(peak([1, 5, 3], [10, 20, 30])).toEqual({ value: 5, at: 20 });
    expect(peak([], [])).toBeNull();
  });
});

describe('rate', () => {
  it('is per second and never negative', () => {
    expect(rate(undefined, 100, 1000)).toBe(0);
    expect(rate(100, 300, 2000)).toBe(100);
    expect(rate(300, 100, 1000)).toBe(0);
    expect(rate(1, 2, 0)).toBe(0);
  });
});

describe('aggregateIpc', () => {
  it('groups calls in the window by command, busiest first', () => {
    const calls = [call('a', 10, 2_000), call('a', 30, 3_000), call('b', 5, 4_000, 7), call('a', 99, 100)];
    const rows = aggregateIpc(calls, 61_000, 60_000);
    expect(rows.map((r) => r.cmd)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ count: 2, avgMs: 20, maxMs: 30 });
    expect(rows[1]).toMatchObject({ count: 1, bytesTotal: 7, bytesLast: 7 });
  });

  it('counts the last second as the live rate', () => {
    const rows = aggregateIpc([call('a', 1, 9_500), call('a', 1, 9_900), call('a', 1, 5_000)], 10_000, 60_000);
    expect(rows[0].perSec).toBe(2);
  });
});

describe('eventsFromCalls', () => {
  it('marks workspace loads, requests and slow calls', () => {
    expect(eventsFromCalls([call('workspace_load_light', 20)], tr).map((e) => e.kind)).toEqual(['workspace']);
    expect(eventsFromCalls([call('http_send', 150)], tr).map((e) => e.kind)).toEqual(['request', 'slow-ipc']);
    expect(eventsFromCalls([call('app_state_set', 5)], tr)).toEqual([]);
  });
});
