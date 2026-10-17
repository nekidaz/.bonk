import { afterEach, describe, expect, it, vi } from 'vitest';

const raw = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: raw }));

import { approxBytes, counted, invoke, ipcMonitor } from './timed';

afterEach(() => {
  ipcMonitor.on = false;
  ipcMonitor.drain();
  raw.mockReset();
});

describe('approxBytes', () => {
  it('counts strings, keys, numbers and null without serialising', () => {
    expect(approxBytes('abc')).toBe(3);
    expect(approxBytes({ a: 'xy', b: [1, 2] })).toBe(20);
    expect(approxBytes(null)).toBe(4);
  });

  it('stops at the budget and returns a lower bound', () => {
    expect(approxBytes(Array(100).fill('ab'), 10)).toBeLessThan(200);
  });

  it('caps the default walk so a huge payload costs a few ms, not a visible hitch', () => {
    expect(approxBytes(Array(300_000).fill('a'))).toBeLessThan(300_000);
  });
});

describe('timed invoke', () => {
  it('records nothing while the monitor is off', async () => {
    raw.mockResolvedValue('hello');
    expect(await invoke('x')).toBe('hello');
    expect(ipcMonitor.drain().calls).toEqual([]);
  });

  it('records command, size and time while on', async () => {
    ipcMonitor.on = true;
    raw.mockResolvedValue('hello');
    await invoke('x', { a: 1 });
    expect(raw).toHaveBeenCalledWith('x', { a: 1 });
    const [call] = ipcMonitor.drain().calls;
    expect(call).toMatchObject({ cmd: 'x', ok: true, bytes: 5 });
    expect(call.ms).toBeGreaterThanOrEqual(0);
  });

  it('records a failed call and rethrows its error', async () => {
    ipcMonitor.on = true;
    raw.mockRejectedValue('boom');
    await expect(invoke('x')).rejects.toBe('boom');
    expect(ipcMonitor.drain().calls).toMatchObject([{ cmd: 'x', ok: false, bytes: 0 }]);
  });

  it('never records its own snapshot command', async () => {
    ipcMonitor.on = true;
    raw.mockResolvedValue({});
    await invoke('monitor_snapshot', { detailed: false });
    expect(ipcMonitor.drain().calls).toEqual([]);
  });

  it('drain empties the call buffer', async () => {
    ipcMonitor.on = true;
    raw.mockResolvedValue(1);
    await invoke('x');
    ipcMonitor.drain();
    expect(ipcMonitor.drain().calls).toEqual([]);
  });
});

describe('counted', () => {
  it('counts channel messages while on and always forwards them', () => {
    const seen: string[] = [];
    const h = counted<string>('pty_open', (m) => seen.push(m));
    h('zz');
    expect(ipcMonitor.drain().channels.pty_open).toBeUndefined();
    ipcMonitor.on = true;
    h('abcd');
    expect(seen).toEqual(['zz', 'abcd']);
    expect(ipcMonitor.drain().channels.pty_open).toEqual({ msgs: 1, bytes: 4 });
  });
});
