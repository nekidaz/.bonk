import type {
  DynamicOptions,
  InputRequest,
  RequestNode,
  RequestSettings,
  RunResultRow,
  Tab,
  SseEvent,
  TreeNode,
} from '$shared/model';
import { mergeScope, parseScriptResult, collectScriptRun } from '$shared/model';
import { currentGrpcPrefs, dynamicOptions, withGlobalImports, requestPrefs } from '$shared/settings';
import { runnerRun, requestRun, type RunEvent, type RunPlan } from '$shared/ipc';
import { tabs, grpcSnapshot } from '$entities/tab';
import { addHistory } from '$entities/history';
import { addAppConsoleEntry } from './console.svelte';
import { effectiveAuth, effectiveScripts, workspace } from '$entities/workspace';
import { environments } from '$entities/environment';
import { closePrompt, inputs, openPrompt } from '$entities/input';
import { methodShort } from './grpc';
import { currentRequestSettings, applyScriptVars } from './executionState';

/**
 * Collection Runner execution: saved requests (HTTP + gRPC) run in bonk-core's runner
 * (`application/runner.rs`, the engine a CLI shares), which streams rows back. Script
 * env/globals writes arrive as `vars` events and fold into the real stores here, so the
 * UI sees them live and they persist. Used by features/runner.
 */

/** The active environment's `name → value` map, or `{}` when none is selected. */
function activeEnvMap(): Record<string, string> {
  const id = environments.activeId;
  const env = id ? environments.list.find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
function globalsMap(): Record<string, string> {
  return mergeScope(environments.globals, undefined);
}

export interface ExecutionContext {
  environmentId: string | null;
  /** A session is kept per environment ('' = none selected). */
  environmentName: string;
  variables: { environment: Record<string, string>; globals: Record<string, string> };
  workspaceRoot: string;
  tree: TreeNode[];
  dynamic: DynamicOptions;
}

/** Capture before an awaited gRPC connect, so its send uses the same workspace and variables. */
export function captureExecutionContext(): ExecutionContext {
  return {
    environmentId: environments.activeId,
    environmentName: environments.active?.name ?? '',
    variables: { environment: activeEnvMap(), globals: globalsMap() },
    workspaceRoot: workspace.path,
    tree: workspace.tree,
    dynamic: dynamicOptions(),
  };
}

/**
 * `node` as the runner gets it: auth and scripts resolved (own and the folders'), no in-memory gRPC
 * state. `skipScripts` (“Send without scripts”) drops the inherited ones too.
 */
function forRun(node: RequestNode, tree = workspace.tree, skipScripts = false): RequestNode {
  const g = node.grpc;
  const scripts = <T extends { preRequestScript?: string; testScript?: string }>(x: T): T => ({
    ...x,
    ...(skipScripts
      ? { preRequestScript: undefined, testScript: undefined }
      : effectiveScripts(tree, node.id, { preRequestScript: x.preRequestScript, testScript: x.testScript })),
  });
  return {
    ...node,
    request: scripts({ ...node.request, auth: effectiveAuth(tree, node.id, node.request.auth) }),
    grpc: g && scripts({ ...g, tree: undefined, connectionId: undefined, auth: effectiveAuth(tree, node.id, g.auth) }),
  };
}

export interface RunOptions {
  dynamic?: DynamicOptions;
  /** Pause / stop it with `runnerPause` / `runnerStop`. */
  runId?: string;
  iterations?: number;
  /** One iteration per row (`pm.iterationData`, and over env/globals in `{{var}}`). */
  dataRows?: Record<string, string>[];
  delayMs?: number;
  stopOnFailure?: boolean;
  requiredVariables?: string[];
  variables?: { environment: Record<string, string>; globals: Record<string, string> };
  /** What a step does when it needs typed input: wait for a person (default) or fail. */
  inputMode?: 'wait' | 'fail';
  /** Tries per step when a 4xx on typed input opens the form again. */
  inputAttempts?: number;
}

/** Run `nodes`; `onEvent` gets progress and rows. Resolves with how the run ended. */
export function runRequests(
  nodes: RequestNode[],
  opts: RunOptions,
  onEvent: (event: RunEvent) => void,
): Promise<'done' | 'stopped'> {
  const environmentId = environments.activeId;
  const plan: RunPlan = {
    requests: nodes.map((node) => forRun(node)),
    requiredVariables: opts.requiredVariables ?? [],
    iterations: opts.iterations ?? 1,
    dataRows: opts.dataRows ?? [],
    delayMs: opts.delayMs ?? 0,
    stopOnFailure: opts.stopOnFailure ?? false,
    workspaceRoot: workspace.path ?? '',
    globalImportPaths: withGlobalImports([]),
    dynamic: opts.dynamic ?? dynamicOptions(),
    inputs: inputs.defs,
    inputMode: opts.inputMode,
    inputAttempts: opts.inputAttempts,
    environmentName: environments.active?.name ?? '',
  };
  const grpc = {
    prefs: currentGrpcPrefs(),
    connectTimeoutMs: requestPrefs.requestTimeoutMs.current,
    deadlineMs: requestPrefs.grpcDeadlineMs.current,
  };
  return runnerRun(
    opts.runId ?? crypto.randomUUID(),
    plan,
    {
      environment: { ...opts.variables?.environment, ...activeEnvMap() },
      globals: { ...globalsMap(), ...opts.variables?.globals },
    },
    currentRequestSettings(),
    grpc,
    (event) => {
      if (event.kind === 'vars') applyScriptVars(event, environmentId, false);
      onEvent(event);
    },
  );
}

/**
 * Run one saved request with `data` as its iteration data (runner re-runs).
 * Never throws: a failure is an `ok: false` row.
 */
export async function runOne(
  node: RequestNode,
  iteration: number,
  data: Record<string, string>,
  options: Pick<RunOptions, 'variables' | 'requiredVariables' | 'dynamic' | 'inputMode'> & {
    /** The step asks for typed input: show its form (the caller answers through `answerInput`). */
    onInput?: (request: InputRequest) => void;
  } = {},
): Promise<RunResultRow> {
  let row: RunResultRow | undefined;
  const { onInput, ...rest } = options;
  try {
    await runRequests([node], { ...rest, dataRows: [data] }, (e) => {
      if (e.kind === 'row') {
        const { kind: _kind, ...r } = e;
        row = r;
      } else if (e.kind === 'input') onInput?.(e);
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

/** An editor send uses the collection pipeline, with full response and script details. */
export function executeRequest(
  node: RequestNode,
  requestId: string,
  settings: RequestSettings,
  connectionId?: string,
  context = captureExecutionContext(),
  onSse?: (e: { kind: 'sseOpen'; started_at_ms: number } | ({ kind: 'sseEvent' } & SseEvent)) => void,
  skipScripts = false,
) {
  const environmentId = context.environmentId;
  return requestRun(
    requestId,
    forRun(node, context.tree, skipScripts),
    {
      requests: [],
      iterations: 1,
      dataRows: [],
      delayMs: 0,
      stopOnFailure: false,
      workspaceRoot: context.workspaceRoot,
      globalImportPaths: withGlobalImports([]),
      dynamic: context.dynamic,
      // The editor shows a 4xx to the person instead of opening the form again.
      inputs: inputs.defs,
      inputAttempts: 1,
      environmentName: context.environmentName,
    },
    context.variables,
    settings,
    {
      prefs: currentGrpcPrefs(),
      connectTimeoutMs: requestPrefs.requestTimeoutMs.current,
      deadlineMs: requestPrefs.grpcDeadlineMs.current,
    },
    (event) => {
      if (event.kind === 'vars') applyScriptVars(event, environmentId, false);
      else if (event.kind === 'input') openPrompt(requestId, event);
      else if (event.kind === 'sseOpen' || event.kind === 'sseEvent') onSse?.(event);
    },
    connectionId,
  ).finally(() => closePrompt(requestId));
}

/** Keep a unary call's response and history on its originating tab. */
export async function sendGrpcRequest(tab: Tab, requestId: string, context = captureExecutionContext()): Promise<void> {
  const g = tab.grpc;
  if (!g) return;
  const { row, details } = await executeRequest(
    {
      kind: 'request',
      id: tab.savedPath ?? '',
      name: tab.title,
      protocol: 'grpc',
      request: tab.request,
      grpc: g,
    },
    requestId,
    currentRequestSettings(),
    g.connectionId,
    context,
  );
  const pre = details.pre ? parseScriptResult(JSON.stringify(details.pre)) : undefined;
  const post = details.post ? parseScriptResult(JSON.stringify(details.post)) : undefined;
  const result = details.grpcResult ?? {
    ok: false,
    status: 'ERROR',
    body: row.error ?? '',
    elapsed_ms: 0,
    size_bytes: 0,
  };
  const testResults = collectScriptRun({
    pre,
    post,
    postMs: details.postMs ?? undefined,
    at: Date.now(),
    send: details.grpcResult
      ? {
          t: Date.now(),
          text: `${methodShort(g.method ?? '')} ${g.endpoint}`,
          status: result.status,
          ms: result.elapsed_ms,
        }
      : undefined,
  });
  tabs.updateById(tab.id, (t) => ({
    ...t,
    testResults,
    grpcResult: pre?.error ? undefined : result,
    grpcStream: undefined,
  }));
  addAppConsoleEntry({
    protocol: 'grpc',
    method: methodShort(g.method ?? '') || 'gRPC',
    url: g.endpoint,
    ok: row.ok,
    status: pre?.error ? 'SCRIPT ERROR' : result.status,
    elapsedMs: row.elapsedMs,
    message: row.error,
    logs: row.logs,
    tests: row.tests,
    scripted: !!(g.preRequestScript?.trim() || g.testScript?.trim()),
    title: tab.title,
    nodeId: tab.savedPath,
    tabId: tab.id,
  });
  if (details.grpcResult)
    addHistory({
      id: crypto.randomUUID(),
      protocol: 'grpc',
      request: { method: 'GRPC', url: g.endpoint + ' ' + (g.method ?? ''), headers: {} },
      status: 0,
      ok: row.ok,
      grpc: grpcSnapshot(g),
      at: Date.now(),
      savedPath: tab.savedPath,
      title: tab.title,
    });
}
