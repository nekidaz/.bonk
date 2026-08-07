/**
 * The Flow interpreter: an async depth-first walk of a Flow graph. All side
 * effects (sending requests, running sandbox scripts, sleeping, progress
 * reporting, cancellation) are injected via `FlowEffects`, so this module stays
 * pure and unit-testable; `stores/flow.ts` wires the real implementations.
 *
 * Semantics:
 * - Exactly one `start` block is required; execution begins there with `{}`.
 * - A single JSON `payload` travels along each edge; fan-out from one port runs
 *   targets sequentially in edge order.
 * - A `request` block never aborts the run — its outcome (`ok: false` included)
 *   becomes the payload, so failures are handled by branching on `payload.ok`.
 * - A fatal script error, a forEach over a non-array, or a dangling edge aborts
 *   the run with `status: 'error'`.
 * - A step counter caps total block executions, so a cyclic graph terminates.
 */
import type { Flow, FlowBlock } from './flow';
import type { RunResultRow } from './types';

export interface FlowRequestOutcome {
  /** The runner row (status/ok/tests/logs) for progress display. */
  row: RunResultRow;
  /** The payload passed on: `{ status, ok, body, elapsedMs, error? }`. */
  output: unknown;
}

export interface FlowScriptOutcome {
  /** The script's `return` value (undefined when it returned nothing). */
  value: unknown;
  logs: string[];
  /** Fatal script error; aborts the run. */
  error?: string;
}

export type FlowBlockState = 'running' | 'ok' | 'error';

export interface FlowEffects {
  runRequest(requestId: string, payload: unknown): Promise<FlowRequestOutcome>;
  runScript(code: string, payload: unknown): Promise<FlowScriptOutcome>;
  sleep(ms: number): Promise<void>;
  /** Progress callback per block (canvas badges). `detail` is state-specific. */
  onBlock(blockId: string, state: FlowBlockState, detail?: unknown): void;
  /** An `output` block fired. */
  onOutput(blockId: string, label: string, payload: unknown): void;
  /** Polled between blocks; true stops the run with `status: 'cancelled'`. */
  isCancelled(): boolean;
}

export type FlowRunStatus = 'done' | 'error' | 'cancelled';

export interface FlowRunSummary {
  status: FlowRunStatus;
  /** Total block executions (loop iterations included). */
  steps: number;
  error?: string;
}

/** Default cap on total block executions (cycle/runaway-loop backstop). */
export const FLOW_MAX_STEPS = 10_000;

/** Internal control-flow signal; carries the summary status + message. */
class FlowAbort extends Error {
  constructor(
    public readonly status: FlowRunStatus,
    message: string,
  ) {
    super(message);
  }
}

/** Execute `flow` with the given effects; never throws. */
export async function executeFlow(
  flow: Flow,
  fx: FlowEffects,
  maxSteps: number = FLOW_MAX_STEPS,
): Promise<FlowRunSummary> {
  const byId = new Map(flow.blocks.map((b) => [b.id, b]));
  const starts = flow.blocks.filter((b) => b.config.type === 'start');
  let steps = 0;

  if (starts.length !== 1) {
    return { status: 'error', steps, error: 'Flow needs exactly one Start block.' };
  }

  /** Run every edge leaving `block` on `port`, sequentially, with `payload`. */
  async function follow(block: FlowBlock, port: string, payload: unknown): Promise<void> {
    for (const e of flow.edges) {
      if (e.from !== block.id || e.fromPort !== port) continue;
      const target = byId.get(e.to);
      if (!target) throw new FlowAbort('error', `Edge ${e.id} points to a missing block.`);
      await exec(target, payload);
    }
  }

  async function exec(block: FlowBlock, payload: unknown): Promise<void> {
    if (fx.isCancelled()) throw new FlowAbort('cancelled', 'Run cancelled.');
    if (++steps > maxSteps) throw new FlowAbort('error', `Flow hit the step limit (${maxSteps}).`);
    const c = block.config;
    fx.onBlock(block.id, 'running');

    switch (c.type) {
      case 'start': {
        fx.onBlock(block.id, 'ok');
        await follow(block, 'out', payload);
        return;
      }
      case 'request': {
        const outcome = await fx.runRequest(c.requestId, payload);
        fx.onBlock(block.id, outcome.row.ok ? 'ok' : 'error', outcome.row);
        await follow(block, 'out', outcome.output);
        return;
      }
      case 'if': {
        const res = await fx.runScript(`return (\n${c.condition}\n);`, payload);
        if (res.error) {
          fx.onBlock(block.id, 'error', res.error);
          throw new FlowAbort('error', res.error);
        }
        fx.onBlock(block.id, 'ok', Boolean(res.value));
        await follow(block, res.value ? 'true' : 'false', payload);
        return;
      }
      case 'loop': {
        if (c.kind === 'forEach') {
          if (!Array.isArray(payload)) {
            const msg = 'Loop (forEach) needs an array payload.';
            fx.onBlock(block.id, 'error', msg);
            throw new FlowAbort('error', msg);
          }
          for (const item of payload) await follow(block, 'each', item);
        } else {
          const count = Math.max(0, Math.round(c.count ?? 0));
          for (let i = 0; i < count; i++) await follow(block, 'each', i);
        }
        fx.onBlock(block.id, 'ok');
        await follow(block, 'done', payload);
        return;
      }
      case 'script': {
        const res = await fx.runScript(c.code, payload);
        if (res.error) {
          fx.onBlock(block.id, 'error', res.error);
          throw new FlowAbort('error', res.error);
        }
        fx.onBlock(block.id, 'ok');
        await follow(block, 'out', res.value);
        return;
      }
      case 'delay': {
        await fx.sleep(c.ms);
        fx.onBlock(block.id, 'ok');
        await follow(block, 'out', payload);
        return;
      }
      case 'output': {
        fx.onOutput(block.id, c.label, payload);
        fx.onBlock(block.id, 'ok');
        await follow(block, 'out', payload);
        return;
      }
    }
  }

  try {
    await exec(starts[0], {});
    return { status: 'done', steps };
  } catch (e) {
    if (e instanceof FlowAbort) return { status: e.status, steps, error: e.message };
    return { status: 'error', steps, error: e instanceof Error ? e.message : String(e) };
  }
}
