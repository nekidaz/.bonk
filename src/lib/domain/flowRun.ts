/**
 * The Flow interpreter: an async depth-first walk of a Flow graph. All side
 * effects (sending requests, running sandbox scripts, sleeping, progress
 * reporting, cancellation) are injected via `FlowEffects`, so this module stays
 * pure and unit-testable; `stores/flow.ts` wires the real implementations.
 *
 * Semantics:
 * - Exactly one `start` block is required; execution begins there with `{}`.
 * - A single JSON `payload` travels along each control edge; fan-out from one
 *   port runs targets sequentially in edge order.
 * - A variable edge (`toPort: 'var:<name>'`) moves no execution: it binds the
 *   source block's last output to that `{{name}}` for the target request only.
 * - A disabled block is skipped, passing its payload straight through.
 * - A `request` block never aborts the run — it leaves through `success` or
 *   `fail` depending on its outcome, and its result (`ok: false` included) is
 *   the payload. An unwired `fail` port ends that branch; flows authored before
 *   these ports existed used a single `out`, which still works.
 * - A fatal script error, a forEach over a non-array, or a dangling edge aborts
 *   the run with `status: 'error'`.
 * - A step counter caps total block executions, so a cyclic graph terminates.
 */
import { isControlEdge, varPortName, type Flow, type FlowBlock } from './flow';
import type { RunResultRow } from './types';
import { get } from 'svelte/store';
import { t } from '../i18n';

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

export type FlowBlockState = 'running' | 'ok' | 'error' | 'skipped';

export interface FlowEffects {
  /**
   * `variables` are the values bound by incoming variable edges; they override
   * the environment for this send only (Postman's per-node variables).
   */
  runRequest(
    requestId: string,
    payload: unknown,
    variables: Record<string, string>,
  ): Promise<FlowRequestOutcome>;
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
    return { status: 'error', steps, error: get(t)('flow.run.needStart') };
  }

  /** Last payload each block emitted this run — what variable edges read. */
  const outputs = new Map<string, unknown>();

  /** Run every control edge leaving `block` on `port`, sequentially. */
  async function follow(block: FlowBlock, port: string, payload: unknown): Promise<void> {
    outputs.set(block.id, payload);
    for (const e of flow.edges) {
      if (e.from !== block.id || e.fromPort !== port || !isControlEdge(e)) continue;
      const target = byId.get(e.to);
      if (!target) throw new FlowAbort('error', get(t)('flow.run.badEdge', { id: e.id }));
      await exec(target, payload);
    }
  }

  /** A value bound into a `{{var}}` is text: objects go in as JSON. */
  function asVariable(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  /**
   * Variables wired into `block` by variable edges. A source that has not run
   * yet contributes nothing, so the environment value stands.
   */
  function boundVariables(block: FlowBlock): Record<string, string> {
    const bound: Record<string, string> = {};
    for (const e of flow.edges) {
      const name = varPortName(e.toPort);
      if (e.to !== block.id || name === null) continue;
      if (!outputs.has(e.from)) continue;
      bound[name] = asVariable(outputs.get(e.from));
    }
    return bound;
  }

  async function exec(block: FlowBlock, payload: unknown): Promise<void> {
    if (fx.isCancelled()) throw new FlowAbort('cancelled', get(t)('flow.run.cancelled'));
    if (++steps > maxSteps) throw new FlowAbort('error', get(t)('flow.run.stepLimit', { max: maxSteps }));
    const c = block.config;
    fx.onBlock(block.id, 'running', payload);

    // A disabled block does nothing but hand its payload to the next block, so a
    // step can be muted without unwiring the graph. It leaves through the first
    // wired port of its pass-through preference ('out' covers legacy wiring).
    if (block.disabled) {
      fx.onBlock(block.id, 'skipped');
      outputs.set(block.id, payload);
      const preferred =
        c.type === 'request' ? ['success', 'out']
        : c.type === 'if' ? ['true', 'out']
        : c.type === 'loop' ? ['done', 'out']
        : ['out'];
      for (const port of preferred) {
        const wired = flow.edges.some(
          (e) => e.from === block.id && e.fromPort === port && isControlEdge(e),
        );
        if (wired) {
          await follow(block, port, payload);
          break;
        }
      }
      return;
    }

    switch (c.type) {
      case 'start': {
        fx.onBlock(block.id, 'ok');
        await follow(block, 'out', payload);
        return;
      }
      case 'request': {
        const outcome = await fx.runRequest(c.requestId, payload, boundVariables(block));
        fx.onBlock(block.id, outcome.row.ok ? 'ok' : 'error', outcome.row);
        const port = outcome.row.ok ? 'success' : 'fail';
        // Flows authored before the success/fail ports wired everything through
        // 'out'; fall back to it when the outcome's port has no edge, so those
        // keep running. A new flow that leaves `fail` unwired stops that branch.
        const wired = flow.edges.some(
          (e) => e.from === block.id && e.fromPort === port && isControlEdge(e),
        );
        await follow(block, wired ? port : 'out', outcome.output);
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
            const msg = get(t)('flow.run.loopNeedsArray');
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
