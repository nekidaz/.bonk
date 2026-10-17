import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';

/**
 * IPC timing for the dev-only Resources tab: every `invoke` (api.ts, shared/persist) goes
 * through here. While `ipcMonitor.on` is false (the default) this is a plain pass-through.
 */

export interface IpcCall {
  cmd: string;
  /** Epoch ms when the call started. */
  at: number;
  ms: number;
  /** `approxBytes` of the result; 0 for a failed call. */
  bytes: number;
  ok: boolean;
}

export interface ChannelTotals {
  msgs: number;
  bytes: number;
}

const MAX_CALLS = 20_000;
/** The monitor's own poll would otherwise be the busiest row. */
const SELF = 'monitor_snapshot';

let calls: IpcCall[] = [];
const channels: Record<string, ChannelTotals> = {};

export const ipcMonitor = {
  on: false,
  /** Calls since the previous drain; channel totals are cumulative. */
  drain(): { calls: IpcCall[]; channels: Record<string, ChannelTotals> } {
    const out = calls;
    calls = [];
    return { calls: out, channels: { ...channels } };
  },
};

function record(call: IpcCall): void {
  calls.push(call);
  if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS);
}

export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (!ipcMonitor.on || cmd === SELF) return rawInvoke<T>(cmd, args, options);
  const at = Date.now();
  const t0 = performance.now();
  try {
    const out = await rawInvoke<T>(cmd, args, options);
    record({ cmd, at, ms: performance.now() - t0, bytes: approxBytes(out), ok: true });
    return out;
  } catch (e) {
    record({ cmd, at, ms: performance.now() - t0, bytes: 0, ok: false });
    throw e;
  }
}

/** Wraps a Channel's `onmessage` handler so its traffic shows up per command. */
export function counted<T>(cmd: string, handler: (msg: T) => void): (msg: T) => void {
  return (msg) => {
    if (ipcMonitor.on) {
      const c = (channels[cmd] ??= { msgs: 0, bytes: 0 });
      c.msgs += 1;
      c.bytes += approxBytes(msg);
    }
    handler(msg);
  };
}

/**
 * Rough payload size without serialising: string → length, object key → length, number 8,
 * boolean / null / undefined 4. Stops after `budget` values, so a huge tree yields a lower
 * bound instead of a long freeze (ponytail: 200k values ≈ a few ms; raise it only if the
 * lower bounds start hiding real sizes).
 */
export function approxBytes(value: unknown, budget = 200_000): number {
  let bytes = 0;
  let left = budget;
  const stack: unknown[] = [value];
  while (stack.length > 0 && left > 0) {
    const v = stack.pop();
    left -= 1;
    if (typeof v === 'string') bytes += v.length;
    else if (typeof v === 'number') bytes += 8;
    else if (v === null || typeof v !== 'object') bytes += 4;
    else if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) bytes += v.byteLength;
    // A loop, not push(...v): spreading a 1M-item array overflows the call stack.
    else if (Array.isArray(v)) for (const item of v) stack.push(item);
    else
      for (const [k, item] of Object.entries(v)) {
        bytes += k.length;
        stack.push(item);
      }
  }
  return bytes;
}
