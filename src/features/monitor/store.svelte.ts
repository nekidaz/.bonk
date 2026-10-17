import { untrack } from 'svelte';
import {
  approxBytes,
  ipcMonitor,
  monitorSnapshot,
  type ChannelTotals,
  type IpcCall,
  type MonitorSnapshot,
} from '$shared/ipc';
import { setting } from '$shared/persist';
import { t } from '$shared/i18n';
import type { Tab, TreeNode } from '$shared/model';
import { tabs } from '$entities/tab';
import { history } from '$entities/history';
import { appConsole } from '$entities/request';
import { workspace } from '$entities/workspace';
import { BUFFER_POINTS, eventsFromCalls, rate, Ring, SAMPLE_MS, type MonitorEvent, type WindowKey } from './series';

/**
 * The dev-only Resources tab: `dev.monitor` in ~/.bonk/settings.json turns it on. While on,
 * one `monitor_snapshot` a second goes into ring buffers (the last hour); the tab only reads them.
 */
export const devMonitor = setting('dev.monitor', 'devMonitor', false);

export interface HeldRow {
  name: string;
  count: number;
  /** Approximate data size; null when it isn't measured. */
  bytes: number | null;
}

/** One point of the summary charts. */
export interface Sample {
  at: number;
  memTotal: number;
  memMain: number;
  /** null when no webview process could be attributed to bonk. */
  memWebview: number | null;
  memOther: number;
  cpuTotal: number;
  netInPerSec: number;
  netOutPerSec: number;
  diskWritePerSec: number;
  fps: number | null;
}

export interface FrameStats {
  fps: number;
  janks: number;
  longestMs: number;
  dom: number;
}

const MAX_CALLS = 20_000;
/** «Data held» walks are heavier: every 5th tick, and only while the tab is visible. */
const HELD_EVERY = 5;

class Monitor {
  // Ring buffers are plain objects (mutated in place); `rev` bumps once per tick so views re-read them.
  samples = new Ring<Sample>(BUFFER_POINTS);
  calls = new Ring<IpcCall>(MAX_CALLS);
  events = new Ring<MonitorEvent>(BUFFER_POINTS);
  /** Per pid: memory and CPU history for the process sparklines. */
  procHistory = new Map<number, { mem: Ring<number>; cpu: Ring<number> }>();
  rev = $state(0);
  latest = $state.raw<MonitorSnapshot | null>(null);
  /** The snapshot before `latest`, for per-second rates in the view. */
  previous = $state.raw<MonitorSnapshot | null>(null);
  /** Largest script runtime memory seen since collection started. */
  scriptPeak = $state(0);
  /** Channel totals now and one tick ago (for msgs/s). */
  channels = $state.raw<Record<string, ChannelTotals>>({});
  prevChannels: Record<string, ChannelTotals> = {};
  held = $state.raw<HeldRow[]>([]);
  frames = $state.raw<FrameStats | null>(null);
  /** One entry per second while the tab is visible, for the FPS chart and jank counts. */
  frameHistory = new Ring<FrameStats & { at: number }>(BUFFER_POINTS);
  /** The Resources tab is on screen (set by MonitorView): enables the detailed snapshot, FPS and «data held». */
  visible = $state(false);
  windowKey = $state<WindowKey>('5m');
  /** Epoch ms when collection started; 0 while off. */
  startedAt = $state(0);

  clear(): void {
    this.samples.clear();
    this.calls.clear();
    this.events.clear();
    this.procHistory.clear();
    this.latest = null;
    this.previous = null;
    this.scriptPeak = 0;
    this.channels = {};
    this.prevChannels = {};
    this.held = [];
    this.frames = null;
    this.frameHistory.clear();
    this.startedAt = 0;
    this.rev = untrack(() => this.rev) + 1;
  }
}
export const monitor = new Monitor();

const heldSources = new Map<string, () => { count: number; bytes: number | null }>();

/** A feature's own «data held» row (wired from app/, since features can't import each other). */
export function registerHeld(name: string, read: () => { count: number; bytes: number | null }): void {
  heldSources.set(name, read);
}

const countNodes = (nodes: TreeNode[]): number =>
  nodes.reduce((n, node) => n + 1 + (node.kind === 'folder' ? countNodes(node.children) : 0), 0);

function readHeld(snap: MonitorSnapshot): HeldRow[] {
  const treeLoad = monitor.calls
    .values()
    .findLast((c) => c.cmd === 'workspace_load_light' || c.cmd === 'workspace_load');
  const list = tabs.list;
  const rows: HeldRow[] = [
    { name: t('monitor.held.tree'), count: countNodes(workspace.tree), bytes: treeLoad?.bytes ?? null },
    {
      name: t('monitor.held.responses'),
      count: list.length,
      bytes: list.reduce((n, tab) => n + (tab.response?.body.length ?? 0), 0),
    },
    { name: t('monitor.held.history'), count: history.list.length, bytes: approxBytes(history.list) },
    { name: t('monitor.held.console'), count: appConsole.entries.length, bytes: approxBytes(appConsole.entries) },
    { name: t('monitor.held.cookies'), count: snap.live.cookies, bytes: null },
  ];
  for (const [name, read] of heldSources) rows.push({ name, ...read() });
  return rows;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function toSample(cur: MonitorSnapshot, prev: MonitorSnapshot | null): Sample {
  const mem = (kind: string) => sum(cur.procs.filter((p) => p.kind === kind).map((p) => p.memBytes));
  const dt = prev ? cur.atMs - prev.atMs : 0;
  const net = (s: MonitorSnapshot, f: 'sent' | 'received') =>
    s.counters.net.http[f] + s.counters.net.grpc[f] + s.counters.net.sse[f];
  const diskWritten = (s: MonitorSnapshot) => sum(s.procs.map((p) => p.diskWriteBytes));
  return {
    at: cur.atMs,
    memTotal: sum(cur.procs.map((p) => p.memBytes)),
    memMain: mem('main'),
    memWebview: cur.procs.some((p) => p.kind === 'webview') ? mem('webview') : null,
    memOther: mem('child'),
    cpuTotal: sum(cur.procs.map((p) => p.cpuPct)),
    netInPerSec: rate(prev ? net(prev, 'received') : undefined, net(cur, 'received'), dt),
    netOutPerSec: rate(prev ? net(prev, 'sent') : undefined, net(cur, 'sent'), dt),
    // A process that exited takes its bytes with it; `rate` reads the drop as 0.
    diskWritePerSec: rate(prev ? diskWritten(prev) : undefined, diskWritten(cur), dt),
    fps: monitor.visible ? (monitor.frames?.fps ?? null) : null,
  };
}

/** From the view's frame sampler (frames.ts). */
export function recordFrames(f: FrameStats): void {
  monitor.frames = f;
  monitor.frameHistory.push({ ...f, at: Date.now() });
}

export function recordJank(at: number, ms: number): void {
  monitor.events.push({ at, kind: 'jank', label: t('monitor.ev.jank', { ms: Math.round(ms) }) });
}

let pending = false;
let ticks = 0;

/** One poll: snapshot + drained IPC calls into the buffers. A tick still waiting skips the next one. */
export async function tick(): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const snap = await monitorSnapshot(monitor.visible);
    if (!timer) return; // stopped while waiting
    const { calls, channels } = ipcMonitor.drain();
    calls.forEach((c) => monitor.calls.push(c));
    eventsFromCalls(calls).forEach((e) => monitor.events.push(e));
    monitor.samples.push(
      toSample(
        snap,
        untrack(() => monitor.latest),
      ),
    );
    const seen = new Set<number>();
    for (const p of snap.procs) {
      seen.add(p.pid);
      let h = monitor.procHistory.get(p.pid);
      if (!h) monitor.procHistory.set(p.pid, (h = { mem: new Ring(300), cpu: new Ring(300) }));
      h.mem.push(p.memBytes);
      h.cpu.push(p.cpuPct);
    }
    for (const pid of monitor.procHistory.keys()) if (!seen.has(pid)) monitor.procHistory.delete(pid);
    monitor.prevChannels = monitor.channels;
    monitor.channels = channels;
    monitor.previous = untrack(() => monitor.latest);
    monitor.latest = snap;
    monitor.scriptPeak = Math.max(
      untrack(() => monitor.scriptPeak),
      snap.counters.scripts.peakMemBytes,
    );
    if (monitor.visible && ticks++ % HELD_EVERY === 0) monitor.held = readHeld(snap);
    monitor.rev = untrack(() => monitor.rev) + 1;
  } catch {
    // The next tick tries again; the previous sample stays on screen.
  } finally {
    pending = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startMonitor(): void {
  if (timer) return;
  ipcMonitor.on = true;
  monitor.startedAt = Date.now();
  timer = setInterval(() => void tick(), SAMPLE_MS);
}

/** Stops polling, empties the buffers and closes the Resources tab. */
export function stopMonitor(): void {
  clearInterval(timer);
  timer = undefined;
  pending = false;
  ticks = 0;
  ipcMonitor.on = false;
  ipcMonitor.drain();
  monitor.clear();
  const list = untrack(() => tabs.list);
  if (!list.some((tab) => tab.protocol === 'monitor')) return;
  const rest = list.filter((tab) => tab.protocol !== 'monitor');
  tabs.update(() => rest);
  if (!rest.some((tab) => tab.id === untrack(() => tabs.activeId))) tabs.activeId = rest.at(-1)?.id ?? '';
}

/** Follows `dev.monitor` for the whole session; started from startApp(). */
export function watchMonitor(): () => void {
  return $effect.root(() => {
    $effect(() => {
      if (devMonitor.current) untrack(startMonitor);
      else untrack(stopMonitor);
    });
    return stopMonitor;
  });
}

/** Open (or focus) the single Resources tab. Like the settings.json tab: no request, not restored. */
export function openMonitorTab(): void {
  const existing = tabs.list.find((tab) => tab.protocol === 'monitor');
  if (existing) {
    tabs.activeId = existing.id;
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'monitor',
    title: t('monitor.title'),
    manualTitle: true,
    request: { method: 'MON', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  tabs.activeId = tab.id;
}
