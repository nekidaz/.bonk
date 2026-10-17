import type { IpcCall } from '$shared/ipc';
import { p95 } from '$shared/model';
import { t, type Translate } from '$shared/i18n';

/**
 * Pure math of the Resources tab: ring buffers, chart downsampling, peaks, counter rates,
 * the IPC table and the event markers. No stores, no I/O — store.svelte.ts and the view call in.
 */

export const SAMPLE_MS = 1000;
/** One hour of 1 s samples. */
export const BUFFER_POINTS = 3600;
export const WINDOWS = { '1m': 60_000, '5m': 300_000, '30m': 1_800_000, all: Infinity } as const;
export type WindowKey = keyof typeof WINDOWS;
export const SLOW_IPC_MS = 100;
/** A frame gap longer than this counts as a jank. */
export const JANK_MS = 50;

/** Fixed-size buffer: pushing past `cap` drops the oldest value. */
export class Ring<T> {
  #items: T[] = [];
  #start = 0;
  constructor(readonly cap: number) {}

  push(v: T): void {
    if (this.#items.length < this.cap) this.#items.push(v);
    else {
      this.#items[this.#start] = v;
      this.#start = (this.#start + 1) % this.cap;
    }
  }

  /** Oldest → newest. */
  values(): T[] {
    return [...this.#items.slice(this.#start), ...this.#items.slice(0, this.#start)];
  }

  last(): T | undefined {
    if (this.#items.length === 0) return undefined;
    return this.#items[(this.#start + this.#items.length - 1) % this.#items.length];
  }

  get length(): number {
    return this.#items.length;
  }

  clear(): void {
    this.#items = [];
    this.#start = 0;
  }
}

/** Bucket `values` into at most `maxPoints`, keeping each bucket's max so peaks survive. */
export function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const size = values.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    let max = -Infinity;
    for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size); j++) max = Math.max(max, values[j]);
    out.push(max);
  }
  return out;
}

export function peak(values: number[], times: number[]): { value: number; at: number } | null {
  if (values.length === 0) return null;
  let i = 0;
  for (let j = 1; j < values.length; j++) if (values[j] > values[i]) i = j;
  return { value: values[i], at: times[i] };
}

/** Per-second rate of a cumulative counter; 0 without a previous value, for dt ≤ 0 or when it went down. */
export function rate(prev: number | undefined, cur: number, dtMs: number): number {
  if (prev === undefined || dtMs <= 0 || cur < prev) return 0;
  return ((cur - prev) * 1000) / dtMs;
}

export interface IpcRow {
  cmd: string;
  count: number;
  /** Calls in the last second. */
  perSec: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  bytesTotal: number;
  bytesLast: number;
}

/** Calls with `at ≥ now − windowMs`, grouped by command, most calls first. */
export function aggregateIpc(calls: IpcCall[], nowMs: number, windowMs: number): IpcRow[] {
  const groups = new Map<string, IpcCall[]>();
  for (const c of calls) {
    if (c.at < nowMs - windowMs) continue;
    const list = groups.get(c.cmd);
    if (list) list.push(c);
    else groups.set(c.cmd, [c]);
  }
  return [...groups]
    .map(([cmd, list]): IpcRow => {
      const ms = list.map((c) => c.ms);
      return {
        cmd,
        count: list.length,
        perSec: list.filter((c) => c.at >= nowMs - 1000).length,
        avgMs: ms.reduce((a, b) => a + b, 0) / list.length,
        p95Ms: p95(ms),
        maxMs: Math.max(...ms),
        bytesTotal: list.reduce((a, c) => a + c.bytes, 0),
        bytesLast: list[list.length - 1].bytes,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export type EventKind = 'workspace' | 'request' | 'runner' | 'slow-ipc' | 'jank';
export interface MonitorEvent {
  at: number;
  kind: EventKind;
  label: string;
}

/** Commands that are user actions worth a marker on the charts. */
const ACTIONS: Record<string, EventKind> = {
  workspace_load: 'workspace',
  workspace_load_light: 'workspace',
  http_send: 'request',
  request_run: 'request',
  grpc_call: 'request',
  grpc_stream: 'request',
  session_run: 'request',
  runner_run: 'runner',
};

export function eventsFromCalls(calls: IpcCall[], tr: Translate = t): MonitorEvent[] {
  const out: MonitorEvent[] = [];
  for (const c of calls) {
    const kind = ACTIONS[c.cmd];
    if (kind) out.push({ at: c.at, kind, label: tr(`monitor.ev.${kind}`) });
    if (c.ms > SLOW_IPC_MS) out.push({ at: c.at, kind: 'slow-ipc', label: `${c.cmd} · ${Math.round(c.ms)} ms` });
  }
  return out;
}
