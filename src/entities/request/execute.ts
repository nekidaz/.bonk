import type { RequestNode, RunResultRow } from '$shared/model';
import { mergeScope } from '$shared/model';
import { currentGrpcPrefs, dynamicOptions, withGlobalImports, requestPrefs } from '$shared/settings';
import { runnerRun, type RunEvent, type RunPlan } from '$shared/ipc';
import { effectiveAuth, workspace } from '$entities/workspace';
import { environments } from '$entities/environment';
import { currentRequestSettings, applyScriptVars } from './store';

/**
 * Collection Runner execution: saved requests (HTTP + gRPC) run in bonk-core's runner
 * (`application/runner.rs`, the engine a CLI shares), which streams rows back. Script
 * env/globals writes arrive as `vars` events and fold into the real stores here, so the
 * UI sees them live and they persist. Used by features/runner and entities/flow.
 */

/** The active environment's `name → value` map, or `{}` when none is selected. */
export function activeEnvMap(): Record<string, string> {
  const id = environments.activeId;
  const env = id ? environments.list.find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
export function globalsMap(): Record<string, string> {
  return mergeScope(environments.globals, undefined);
}

/** `node` as the runner gets it: auth resolved (own or the folder's), no in-memory gRPC state. */
function forRun(node: RequestNode): RequestNode {
  const tree = workspace.tree;
  const g = node.grpc;
  return {
    ...node,
    request: { ...node.request, auth: effectiveAuth(tree, node.id, node.request.auth) },
    grpc: g && { ...g, tree: undefined, connectionId: undefined, auth: effectiveAuth(tree, node.id, g.auth) },
  };
}

export interface RunOptions {
  /** Pause / stop it with `runnerPause` / `runnerStop`. */
  runId?: string;
  iterations?: number;
  /** One iteration per row (`pm.iterationData`, and over env/globals in `{{var}}`). */
  dataRows?: Record<string, string>[];
  delayMs?: number;
  stopOnFailure?: boolean;
}

/** Run `nodes`; `onEvent` gets progress and rows. Resolves with how the run ended. */
export function runRequests(
  nodes: RequestNode[],
  opts: RunOptions,
  onEvent: (event: RunEvent) => void,
): Promise<'done' | 'stopped'> {
  const plan: RunPlan = {
    requests: nodes.map(forRun),
    iterations: opts.iterations ?? 1,
    dataRows: opts.dataRows ?? [],
    delayMs: opts.delayMs ?? 0,
    stopOnFailure: opts.stopOnFailure ?? false,
    workspaceRoot: workspace.path ?? '',
    globalImportPaths: withGlobalImports([]),
    dynamic: dynamicOptions(),
  };
  const grpc = {
    prefs: currentGrpcPrefs(),
    connectTimeoutMs: requestPrefs.requestTimeoutMs,
    deadlineMs: requestPrefs.grpcDeadlineMs,
  };
  return runnerRun(
    opts.runId ?? crypto.randomUUID(),
    plan,
    { environment: activeEnvMap(), globals: globalsMap() },
    currentRequestSettings(),
    grpc,
    (event) => {
      if (event.kind === 'vars') applyScriptVars(event);
      onEvent(event);
    },
  );
}

/**
 * Run one saved request with `data` as its iteration data (Flow blocks, runner re-runs).
 * Never throws: a failure is an `ok: false` row.
 */
export async function runOne(
  node: RequestNode,
  iteration: number,
  data: Record<string, string>,
): Promise<RunResultRow> {
  let row: RunResultRow | undefined;
  try {
    await runRequests([node], { dataRows: [data] }, (e) => {
      if (e.kind === 'row') {
        const { kind: _kind, ...r } = e;
        row = r;
      }
    });
  } catch (e) {
    return failedRow(node, iteration, e instanceof Error ? e.message : String(e));
  }
  return row ? { ...row, iteration } : failedRow(node, iteration, 'no result');
}

function failedRow(node: RequestNode, iteration: number, error: string): RunResultRow {
  return {
    id: crypto.randomUUID(),
    iteration,
    requestName: node.name,
    protocol: node.protocol,
    method: node.protocol === 'grpc' ? 'gRPC' : node.request.method,
    target: node.protocol === 'grpc' ? (node.grpc?.endpoint ?? '') : node.request.url,
    status: 'ERR',
    ok: false,
    elapsedMs: 0,
    tests: [],
    logs: [],
    error,
    nodeId: node.id,
  };
}
