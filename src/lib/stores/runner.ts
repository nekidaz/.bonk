import { get, writable } from 'svelte/store';
import type {
  Tab,
  TreeNode,
  RequestNode,
  HttpRequest,
  RunResultRow,
  RunStatus,
  ScriptTestResult,
} from '../domain/types';
import { httpSend, runScript, grpcConnect, grpcReflect, grpcCall, grpcLoadProto } from '../api';
import { findNode } from '../domain/tree';
import { grpcPathsToAbs } from '../domain/protoPaths';
import { mergeScope, resolveRequestVars, resolveVars } from '../domain/vars';
import { applyRequestPatch, buildScriptContext, applyGrpcRequestPatch, buildGrpcScriptContext } from '../domain/scripts';
import { inferGrpcPlaintext, grpcConnectFailureMessage, methodShort } from '../domain/grpc';
import {
  tabs,
  activeTabId,
  collections,
  workspacePath,
  globals,
  environments,
  activeEnvironmentId,
} from './state';
import { currentRequestSettings, applyScriptVars } from './requests';

/**
 * The Collection Runner: runs a whole folder of saved requests (HTTP + gRPC) in
 * sequence, optionally over multiple iterations and/or a CSV/JSON data file,
 * streaming results live. It reuses the interactive send + script pipeline
 * (mirroring `sendHttpRequest`) but returns data rather than writing to a tab.
 *
 * Layering matches `requests.ts`: this module depends on `state`, `requests`
 * (for the shared `applyScriptVars` fold + request settings), `api`, and pure
 * `domain/*` helpers only — never the other way round — so the stores import
 * graph stays acyclic.
 *
 * Env/globals writes made by scripts persist across the WHOLE run: each request
 * folds its writes into the real stores via `applyScriptVars`, and every request
 * recomputes its env/globals maps FRESH (read at that moment) so a later request
 * sees an earlier one's writes.
 */

/** Sentinel folder id meaning "the whole tree" (root). Also matches `null`. */
export const RUNNER_ROOT = '__root__';

/** Runner configuration: what to run and how. */
export interface RunnerConfig {
  /** Folder id to run, `null`/RUNNER_ROOT for the whole tree. */
  folderId: string | null;
  /** Iteration count when NOT data-driven; ignored once a data file is loaded. */
  iterations: number;
  /** Delay between requests, milliseconds. */
  delayMs: number;
  /** Halt the run on the first non-ok request. */
  stopOnFailure: boolean;
  /** Loaded data file name, or null when none. */
  dataFileName: string | null;
  /** Parsed data rows; when non-empty the run is data-driven (one row/iteration). */
  dataRows: Record<string, string>[];
}

/** Live run state, streamed to the RunnerView as it executes. */
export interface RunnerRun {
  status: RunStatus;
  results: RunResultRow[];
  total: number;
  completed: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const DEFAULT_CONFIG: RunnerConfig = {
  folderId: null,
  iterations: 1,
  delayMs: 0,
  stopOnFailure: false,
  dataFileName: null,
  dataRows: [],
};

const DEFAULT_RUN: RunnerRun = {
  status: 'idle',
  results: [],
  total: 0,
  completed: 0,
  startedAt: null,
  finishedAt: null,
};

export const runnerConfig = writable<RunnerConfig>({ ...DEFAULT_CONFIG });
export const runnerRun = writable<RunnerRun>({ ...DEFAULT_RUN, results: [] });

/**
 * Open (or focus) the single Collection Runner tab. Mirrors openEnvironmentsTab:
 * 'runner' tabs hold no request state, are excluded from persistence, and at
 * most one exists at a time.
 */
export function openRunnerTab(): void {
  const existing = get(tabs).find((t) => t.protocol === 'runner');
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'runner',
    title: 'Runner',
    manualTitle: true,
    request: { method: 'RUN', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

// ---- Config setters ----

export function setRunnerFolder(folderId: string | null): void {
  runnerConfig.update((c) => ({ ...c, folderId }));
}
export function setIterations(iterations: number): void {
  const n = Number.isFinite(iterations) ? Math.max(1, Math.round(iterations)) : 1;
  runnerConfig.update((c) => ({ ...c, iterations: n }));
}
export function setDelay(delayMs: number): void {
  const n = Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0;
  runnerConfig.update((c) => ({ ...c, delayMs: n }));
}
export function setStopOnFailure(stopOnFailure: boolean): void {
  runnerConfig.update((c) => ({ ...c, stopOnFailure }));
}
/** Load a parsed data file: makes the run data-driven (rows.length iterations). */
export function loadDataRows(name: string, rows: Record<string, string>[]): void {
  runnerConfig.update((c) => ({ ...c, dataFileName: name, dataRows: rows }));
}
/** Clear the loaded data file, reverting to the numeric iteration count. */
export function clearData(): void {
  runnerConfig.update((c) => ({ ...c, dataFileName: null, dataRows: [] }));
}

// ---- Run scope helpers (recomputed FRESH per request; see the fold note) ----

/** The active environment's `name → value` map, or `{}` when none is selected. */
function activeEnvMap(): Record<string, string> {
  const id = get(activeEnvironmentId);
  const env = id ? get(environments).find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
function globalsMap(): Record<string, string> {
  return mergeScope(get(globals), undefined);
}

/**
 * Build the `{{var}}` resolution scope for one request. Precedence is
 * iterationData > active env > globals, so a data-file column overrides an env
 * var of the same name (matching the `pm.variables.get` precedence in the
 * script prelude). Read fresh each call so earlier script writes are visible.
 */
function runScopeFor(iterationData: Record<string, string>): Record<string, string> {
  return { ...globalsMap(), ...activeEnvMap(), ...iterationData };
}

/**
 * Flatten a folder's descendant request nodes in tree order (depth-first,
 * folder order preserved; only `kind === 'request'`). Descends into nested
 * folders. When `folderId` is root/sentinel the whole tree is flattened.
 */
function flattenRequests(nodes: TreeNode[]): RequestNode[] {
  const out: RequestNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'request') out.push(node);
    else out.push(...flattenRequests(node.children));
  }
  return out;
}

/** Resolve the configured folder to the request list to run (root = whole tree). */
function collectRequests(config: RunnerConfig): RequestNode[] {
  const tree = get(collections);
  if (!config.folderId || config.folderId === RUNNER_ROOT) return flattenRequests(tree);
  const node = findNode(tree, config.folderId);
  if (!node) return [];
  if (node.kind === 'request') return [node];
  return flattenRequests(node.children);
}

/** Result of the headless HTTP pipeline (returned, not written to a tab). */
interface HttpRunOutcome {
  status: number;
  elapsedMs: number;
  tests: ScriptTestResult[];
  logs: string[];
  error?: string;
}

/**
 * Headless HTTP pipeline, derived from `sendHttpRequest` but returning data
 * instead of writing to a tab. Folds pre-request + test script env/globals
 * writes into the real stores as it goes (via the shared `applyScriptVars`), so
 * later requests in the run observe them. `iterationData` feeds both the script
 * context (`pm.iterationData`) and the `{{var}}` scope.
 */
async function runHttp(
  req: HttpRequest,
  iterationData: Record<string, string>,
): Promise<HttpRunOutcome> {
  const tests: ScriptTestResult[] = [];
  const logs: string[] = [];
  let outgoing = req;

  // 1. Pre-request script — against the raw request; writes fold into the stores
  //    (feeding {{var}} resolution below) and a fatal error aborts this request.
  if (req.preRequestScript && req.preRequestScript.trim() !== '') {
    const context = buildScriptContext(req, undefined, activeEnvMap(), globalsMap(), iterationData);
    const pre = await runScript('pre-request', req.preRequestScript, context);
    applyScriptVars(pre);
    logs.push(...pre.logs);
    tests.push(...pre.tests);
    if (pre.error) return { status: 0, elapsedMs: 0, tests, logs, error: pre.error };
    outgoing = applyRequestPatch(outgoing, pre.requestPatch);
  }

  // 2. Interpolate {{var}} placeholders (fresh scope, now including pre-request
  //    writes), then send.
  const resolved = resolveRequestVars(outgoing, runScopeFor(iterationData));
  const requestId = crypto.randomUUID();
  const res = await httpSend(resolved, requestId, currentRequestSettings());

  // 3. Test script — against the response; its env/globals writes fold too.
  let error: string | undefined;
  if (req.testScript && req.testScript.trim() !== '') {
    const context = buildScriptContext(resolved, res, activeEnvMap(), globalsMap(), iterationData);
    const post = await runScript('test', req.testScript, context);
    applyScriptVars(post);
    logs.push(...post.logs);
    tests.push(...post.tests);
    error = post.error ?? undefined;
  }

  return { status: res.status, elapsedMs: res.elapsed_ms, tests, logs, error };
}

/** True when every recorded test passed (vacuously true with no tests). */
function allTestsPassed(tests: ScriptTestResult[]): boolean {
  return tests.every((t) => t.passed);
}

/** Sleep helper for the inter-request delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append a streamed result row (new array so Svelte reactivity fires). */
function pushRow(row: RunResultRow): void {
  runnerRun.update((r) => ({ ...r, results: [...r.results, row], completed: r.completed + 1 }));
}

/**
 * Execute one saved HTTP request for iteration `iteration` and return its row.
 * A transport throw becomes an `ok:false` row (never crashes the run).
 */
async function runHttpNode(
  node: RequestNode,
  iteration: number,
  iterationData: Record<string, string>,
): Promise<RunResultRow> {
  const scope = runScopeFor(iterationData);
  const target = resolveVars(node.request.url, scope);
  try {
    const out = await runHttp(node.request, iterationData);
    const ok =
      out.error === undefined &&
      out.status >= 200 &&
      out.status < 300 &&
      allTestsPassed(out.tests);
    return {
      id: crypto.randomUUID(),
      iteration,
      requestName: node.name,
      protocol: 'http',
      method: node.request.method,
      target,
      status: out.status,
      ok,
      elapsedMs: out.elapsedMs,
      tests: out.tests,
      logs: out.logs,
      error: out.error,
    };
  } catch (e) {
    return {
      id: crypto.randomUUID(),
      iteration,
      requestName: node.name,
      protocol: 'http',
      method: node.request.method,
      target,
      status: 'ERR',
      ok: false,
      elapsedMs: 0,
      tests: [],
      logs: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Execute one saved gRPC request for iteration `iteration` and return its row.
 * Mirrors `runHttp`'s script pipeline (pre-request + test, folding env/globals
 * writes via `applyScriptVars`), with one gRPC-specific constraint: the
 * pre-request script runs AFTER the connection is dialed (a live connection is
 * needed just to know the method exists), so it can patch message/metadata but
 * not the endpoint. The whole connect → (proto/reflect) → call cycle is
 * wrapped so ANY failure yields an `ok:false` row and the run continues.
 */
async function runGrpcNode(
  node: RequestNode,
  iteration: number,
  iterationData: Record<string, string>,
): Promise<RunResultRow> {
  const g = node.grpc;
  const scope = runScopeFor(iterationData);
  const endpoint = resolveVars(g?.endpoint ?? '', scope);
  const target = `${endpoint} · ${g?.method ? methodShort(g.method) : ''}`.trim();
  const tests: ScriptTestResult[] = [];
  const logs: string[] = [];
  const base = {
    id: crypto.randomUUID(),
    iteration,
    requestName: node.name,
    protocol: 'grpc' as const,
    method: 'gRPC',
    target,
    tests,
    logs,
  };
  if (!g || !g.endpoint.trim() || !g.method) {
    return { ...base, status: 'ERR', ok: false, elapsedMs: 0, error: 'Missing endpoint or method.' };
  }
  try {
    // Plaintext: honour the saved flag, else infer from the RESOLVED endpoint
    // (the :443 may live inside a {{var}} value).
    const plaintext = g.plaintext !== undefined ? g.plaintext : inferGrpcPlaintext(endpoint);
    const connId = await grpcConnect(endpoint, plaintext);
    // Load the schema so the call can be encoded: proto source compiles files,
    // otherwise reflection lists the services.
    if (g.source === 'proto') {
      const abs = grpcPathsToAbs(g, get(workspacePath));
      await grpcLoadProto(connId, abs?.protoPaths ?? [], abs?.importPaths ?? []);
    } else {
      await grpcReflect(connId);
    }

    let message = g.message;
    let metadata = g.metadata;
    if (g.preRequestScript && g.preRequestScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint, message, metadata },
        undefined,
        activeEnvMap(),
        globalsMap(),
        iterationData,
      );
      const pre = await runScript('pre-request', g.preRequestScript, context);
      applyScriptVars(pre);
      logs.push(...pre.logs);
      tests.push(...pre.tests);
      if (pre.error) return { ...base, status: 'ERR', ok: false, elapsedMs: 0, error: pre.error };
      const patched = applyGrpcRequestPatch({ method: g.method, endpoint, message, metadata }, pre.requestPatch);
      message = patched.message;
      metadata = patched.metadata;
    }

    const resolvedMessage = resolveVars(message, scope);
    const resolvedMetadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(metadata)) resolvedMetadata[k] = resolveVars(v, scope);
    const result = await grpcCall(connId, g.method, resolvedMessage, resolvedMetadata);

    let error: string | undefined;
    if (g.testScript && g.testScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint, message: resolvedMessage, metadata: resolvedMetadata },
        result,
        activeEnvMap(),
        globalsMap(),
        iterationData,
      );
      const post = await runScript('test', g.testScript, context);
      applyScriptVars(post);
      logs.push(...post.logs);
      tests.push(...post.tests);
      error = post.error ?? undefined;
    }

    return {
      ...base,
      status: result.status,
      ok: result.ok && error === undefined && allTestsPassed(tests),
      elapsedMs: result.elapsed_ms,
      error,
    };
  } catch (e) {
    return {
      ...base,
      status: 'ERR',
      ok: false,
      elapsedMs: 0,
      error: grpcConnectFailureMessage(g.source, 'dial', e),
    };
  }
}

/**
 * Run the configured folder. Determines the iteration count (data rows when a
 * file is loaded, else the numeric setting), streams a row per executed request,
 * and honours stop-on-failure + the inter-request delay. Never throws: a bad
 * request becomes an `ok:false` row.
 */
export async function runCollection(): Promise<void> {
  const config = get(runnerConfig);
  const requests = collectRequests(config);
  if (requests.length === 0) {
    // Nothing to run — surface an empty "done" so the summary/empty state shows.
    runnerRun.set({ ...DEFAULT_RUN, status: 'done', results: [], startedAt: Date.now(), finishedAt: Date.now() });
    return;
  }

  const dataDriven = config.dataRows.length > 0;
  const iterations = dataDriven ? config.dataRows.length : Math.max(1, config.iterations);

  runnerRun.set({
    status: 'running',
    results: [],
    total: requests.length * iterations,
    completed: 0,
    startedAt: Date.now(),
    finishedAt: null,
  });

  for (let i = 1; i <= iterations; i++) {
    const iterationData = dataDriven ? (config.dataRows[i - 1] ?? {}) : {};
    for (let j = 0; j < requests.length; j++) {
      const node = requests[j];
      const row =
        node.protocol === 'grpc'
          ? await runGrpcNode(node, i, iterationData)
          : await runHttpNode(node, i, iterationData);
      pushRow(row);

      if (config.stopOnFailure && !row.ok) {
        runnerRun.update((r) => ({ ...r, status: 'stopped', finishedAt: Date.now() }));
        return;
      }

      // Delay before the next request; skip after the very last one of the run.
      const isLast = i === iterations && j === requests.length - 1;
      if (config.delayMs > 0 && !isLast) await sleep(config.delayMs);
    }
  }

  runnerRun.update((r) => ({ ...r, status: 'done', finishedAt: Date.now() }));
}

/**
 * Build a JSON report of the last run and copy it to the clipboard (matching the
 * app's existing `navigator.clipboard.writeText` usage). Returns true on
 * success. Safe to call when nothing has run (reports an empty run).
 */
export async function exportReport(): Promise<boolean> {
  const config = get(runnerConfig);
  const run = get(runnerRun);
  const report = {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    config: {
      folderId: config.folderId,
      iterations: config.dataRows.length > 0 ? config.dataRows.length : Math.max(1, config.iterations),
      delayMs: config.delayMs,
      stopOnFailure: config.stopOnFailure,
      dataFileName: config.dataFileName,
      dataRowCount: config.dataRows.length,
    },
    total: run.total,
    completed: run.completed,
    passed: run.results.filter((r) => r.ok).length,
    failed: run.results.filter((r) => !r.ok).length,
    rows: run.results,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch (e) {
    console.error('runner: exportReport failed', e);
    return false;
  }
}
