import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MonitorSnapshot, ProcStat } from '$shared/ipc';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
const monitorSnapshot = vi.hoisted(() => vi.fn());
vi.mock('$shared/ipc', async (original) => ({
  ...(await original<typeof import('$shared/ipc')>()),
  monitorSnapshot,
}));

import { ipcMonitor } from '$shared/ipc';
import { tabs } from '$entities/tab';
import { monitor, openMonitorTab, startMonitor, stopMonitor } from './store.svelte';

const proc = (pid: number, kind: ProcStat['kind'], memBytes: number): ProcStat => ({
  pid,
  name: `p${pid}`,
  kind,
  memBytes,
  cpuPct: 1,
  threads: null,
  openFiles: null,
  diskReadBytes: 0,
  diskWriteBytes: 0,
});
const net = { sent: 0, received: 0, count: 0 };
const snap = (procs: ProcStat[]): MonitorSnapshot => ({
  atMs: Date.now(),
  procs,
  counters: {
    net: { http: net, grpc: net, sse: net },
    diskWrites: { state: { count: 0, bytes: 0 }, settings: { count: 0, bytes: 0 }, workspace: { count: 0, bytes: 0 } },
    scripts: { runs: 0, totalMs: 0, peakMemBytes: 0 },
  },
  live: {
    httpClients: 0,
    grpcConns: 0,
    grpcStreams: 0,
    liveStreams: 0,
    inFlight: 0,
    runs: 0,
    pendingInputs: 0,
    oauthLogins: 0,
    terminals: 0,
    watcherOn: false,
    cookieJars: 0,
    cookies: 0,
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  monitorSnapshot.mockReset();
  monitorSnapshot.mockImplementation(async () => snap([proc(1, 'main', 100), proc(2, 'webview', 50)]));
  tabs.list = [];
  tabs.activeId = '';
});

afterEach(() => {
  stopMonitor();
  vi.useRealTimers();
});

it('does nothing until started', async () => {
  await vi.advanceTimersByTimeAsync(5000);
  expect(monitorSnapshot).not.toHaveBeenCalled();
  expect(ipcMonitor.on).toBe(false);
});

it('polls once a second while started', async () => {
  startMonitor();
  expect(ipcMonitor.on).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(monitorSnapshot).toHaveBeenCalledTimes(3);
  expect(monitor.samples.length).toBe(3);
});

it('skips a tick while the previous snapshot is still pending', async () => {
  monitorSnapshot.mockImplementation(() => new Promise(() => {}));
  startMonitor();
  await vi.advanceTimersByTimeAsync(3000);
  expect(monitorSnapshot).toHaveBeenCalledTimes(1);
});

it('stopping closes the tab, clears the buffers and stops polling', async () => {
  startMonitor();
  openMonitorTab();
  await vi.advanceTimersByTimeAsync(2000);
  stopMonitor();
  expect(tabs.list.some((t) => t.protocol === 'monitor')).toBe(false);
  expect(monitor.samples.length).toBe(0);
  expect(ipcMonitor.on).toBe(false);
  monitorSnapshot.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  expect(monitorSnapshot).not.toHaveBeenCalled();
});

it('reports interface memory as null when no webview process is found', async () => {
  monitorSnapshot.mockImplementation(async () => snap([proc(1, 'main', 100), proc(3, 'child', 20)]));
  startMonitor();
  await vi.advanceTimersByTimeAsync(1000);
  expect(monitor.samples.last()).toMatchObject({ memWebview: null, memTotal: 120, memMain: 100, memOther: 20 });
});

it('opens a single monitor tab and focuses it', () => {
  openMonitorTab();
  openMonitorTab();
  const mine = tabs.list.filter((t) => t.protocol === 'monitor');
  expect(mine).toHaveLength(1);
  expect(tabs.activeId).toBe(mine[0].id);
});
