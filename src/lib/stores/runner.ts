import { get, writable } from 'svelte/store';
import { t, type Translate } from '../i18n';
import type {
  Tab,
  TreeNode,
  RequestNode,
  HttpRequest,
  RunResultRow,
  RunStatus,
  ScriptTestResult,
} from '../domain/types';
import { grpcTlsFor, currentGrpcPrefs, withGlobalImports } from './netPrefs';
import { httpSend, runScript, grpcConnect, grpcReflect, grpcCall, grpcLoadProto, workspaceSaveRequest } from '../api';
import { findNode, idToRel, parentId } from '../domain/tree';
import { pushHistory, pushRecord, summarizeRun, toRecord, type IdBinding, type RunRecord, type RunSummary } from '../domain/runnerStats';
import { isPreset, upsertPreset, type RunnerPreset } from '../domain/runnerPreset';
import { isArrayOf, loadState, saveState, saveStateDebounced } from '../persist';
import { grpcPathsToAbs } from '../domain/protoPaths';
import { mergeScope, resolveRequestVars, resolveVars } from '../domain/vars';
import { applyRequestPatch, buildScriptContext, applyGrpcRequestPatch, buildGrpcScriptContext } from '../domain/scripts';
import { inferGrpcPlaintext, grpcConnectFailureMessage, methodShort, outgoingGrpcMetadata, stripsAuthorization, grpcAuthMetadata } from '../domain/grpc';
import { effectiveAuth } from '../domain/authInherit';
import { buildUrl } from '../domain/http';
import { buildRequestForSend } from '../domain/httpBody';
import {
  tabs,
  activeTabId,
  collections,
  workspacePath,
  globals,
  environments,
  activeEnvironmentId,
  withInheritedAuth,
  ROOT,
  requestTimeoutMs,
  grpcDeadlineMs,
} from './state';
import { currentRequestSettings, applyScriptVars } from './requests';
import { reloadWorkspace } from './workspace';
import { setActiveEnvironment } from './environments';

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
  /** Folder ids to run, in order; empty = the whole tree. */
  folderIds: string[];
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
  /** Requests unchecked in the setup list (R2). */
  excludedIds: string[];
  /** Custom run order (request ids); requests missing from it keep tree order, after it. */
  orderIds: string[];
  /** Keep (truncated) response bodies in the saved run records and the exported report. */
  saveResponses: boolean;
}

/** Which Runner screen the tab shows: R1 pick a collection, R2 set the run up, R3/R4 the run. */
export type RunnerStage = 'pick' | 'setup' | 'run';

/** Live run state, streamed to the RunnerView as it executes. */
export interface RunnerRun {
  status: RunStatus;
  results: RunResultRow[];
  total: number;
  completed: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Run number (#42), 0 before the first run. */
  n: number;
  /** Iterations planned for this run (matrix columns). */
  iterations: number;
  paused: boolean;
  /** The call in flight (R3 log head). */
  current: { nodeId: string; name: string; method: string; startedAt: number } | null;
  /** Start of each iteration, ms since the run started (R3 log). */
  iterStarts: number[];
}

const DEFAULT_CONFIG: RunnerConfig = {
  folderIds: [],
  iterations: 1,
  delayMs: 0,
  stopOnFailure: false,
  dataFileName: null,
  dataRows: [],
  excludedIds: [],
  orderIds: [],
  saveResponses: true,
};

const DEFAULT_RUN: RunnerRun = {
  status: 'idle',
  results: [],
  total: 0,
  completed: 0,
  startedAt: null,
  finishedAt: null,
  n: 0,
  iterations: 0,
  paused: false,
  current: null,
  iterStarts: [],
};

export const runnerConfig = writable<RunnerConfig>({ ...DEFAULT_CONFIG });
export const runnerRun = writable<RunnerRun>({ ...DEFAULT_RUN, results: [] });
/** Last HISTORY_LIMIT finished runs (app state, not the workspace). */
export const runnerHistory = writable<RunSummary[]>([]);
export const runnerStage = writable<RunnerStage>('pick');
/** Per-call results of the last HISTORY_LIMIT runs, so a past run can be reopened (R4 bars). */
export const runnerRecords = writable<RunRecord[]>([]);
/** Run number shown read-only in the run view (an older run); null = the latest / live run. */
export const runnerViewing = writable<number | null>(null);
/** Saved setups (R2 «Сохранить как пресет»), loaded from the R1 list. */
export const runnerPresets = writable<RunnerPreset[]>([]);
const PRESETS_KEY = 'runnerPresets';

const CONFIG_KEY = 'runnerConfig';
const HISTORY_KEY = 'runnerHistory';
const RECORDS_KEY = 'runnerRecords';
const isRecord = (v: unknown): v is RunRecord =>
  typeof v === 'object' && v !== null && typeof (v as RunRecord).n === 'number' && Array.isArray((v as RunRecord).results);
const isSummary = (v: unknown): v is RunSummary =>
  typeof v === 'object' && v !== null && typeof (v as RunSummary).n === 'number' && typeof (v as RunSummary).durationMs === 'number';

let loaded: Promise<void> | undefined;
/** Load the persisted runner settings + run history once (idempotent). */
export function loadRunnerState(): Promise<void> {
  loaded ??= (async () => {
    const [saved, hist, records, presets] = await Promise.all([
      loadState<Record<string, unknown>>(CONFIG_KEY, {}),
      loadState(HISTORY_KEY, [] as RunSummary[], isArrayOf(isSummary)),
      loadState(RECORDS_KEY, [] as RunRecord[], isArrayOf(isRecord)),
      loadState(PRESETS_KEY, [] as RunnerPreset[], isArrayOf(isPreset)),
    ]);
    const c = typeof saved === 'object' && saved ? saved : {};
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    runnerConfig.update((cur) => ({
      ...cur,
      folderIds: Array.isArray(c.folderIds) ? ids(c.folderIds) : cur.folderIds,
      excludedIds: ids(c.excludedIds),
      orderIds: ids(c.orderIds),
      iterations: typeof c.iterations === 'number' ? c.iterations : cur.iterations,
      delayMs: typeof c.delayMs === 'number' ? c.delayMs : cur.delayMs,
      stopOnFailure: typeof c.stopOnFailure === 'boolean' ? c.stopOnFailure : cur.stopOnFailure,
      saveResponses: typeof c.saveResponses === 'boolean' ? c.saveResponses : cur.saveResponses,
    }));
    runnerHistory.set(hist);
    runnerRecords.set(records);
    runnerPresets.set(presets);
    runnerPresets.subscribe((list) => saveStateDebounced(PRESETS_KEY, list)); // only after the load, so [] can't wipe it
    syncRunnerTabTitle();
  })();
  return loaded;
}

function persistConfig(): void {
  const { folderIds, iterations, delayMs, stopOnFailure, excludedIds, orderIds, saveResponses } = get(runnerConfig);
  saveStateDebounced(CONFIG_KEY, { folderIds, iterations, delayMs, stopOnFailure, excludedIds, orderIds, saveResponses });
}

/** Header title of the run scope: the first chosen folder, else "Все запросы". */
export function runnerScopeTitle(folderIds: string[], tree: TreeNode[], tr: Translate = get(t)): string {
  for (const id of folderIds) {
    const node = findNode(tree, id);
    if (node) return node.name;
  }
  return tr('runner.allRequests');
}

/** Keep the runner tab named "Runner · <scope>". */
function syncRunnerTabTitle(): void {
  const title = get(runnerStage) === 'pick' ? get(t)('runner.tab.new') : `Runner · ${runnerScopeTitle(get(runnerConfig).folderIds, get(collections))}`;
  if (get(tabs).some((t) => t.protocol === 'runner' && t.title !== title)) {
    tabs.update((list) => list.map((t) => (t.protocol === 'runner' ? { ...t, title } : t)));
  }
}

/**
 * Open (or focus) the single Collection Runner tab. Mirrors openEnvironmentsTab:
 * 'runner' tabs hold no request state, are excluded from persistence, and at
 * most one exists at a time.
 */
export function openRunnerTab(): void {
  void loadRunnerState();
  const existing = get(tabs).find((t) => t.protocol === 'runner');
  if (existing) {
    activeTabId.set(existing.id);
    syncRunnerTabTitle();
    return;
  }
  if (get(runnerRun).n === 0) runnerStage.set('pick');
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'runner',
    title: 'Runner',
    manualTitle: true,
    request: { method: 'RUN', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
  syncRunnerTabTitle();
}

/** Switch the Runner screen (R1 pick / R2 setup / R3-R4 run). */
export function setRunnerStage(stage: RunnerStage): void {
  runnerStage.set(stage);
  syncRunnerTabTitle();
}

/** Tree context menu "Запустить в Runner": scope to the folder and open its setup (R2). */
export function runInRunner(folderId: string): void {
  setRunnerFolders([folderId]);
  runnerStage.set('setup');
  openRunnerTab();
}

/** R1 "repeat a recent run": restore its scope, iterations and environment, then run. */
export function repeatRun(s: RunSummary): void {
  if (s.folderIds) setRunnerFolders(s.folderIds);
  if (s.iterations && get(runnerConfig).dataRows.length === 0) setIterations(s.iterations);
  if (s.envId !== undefined && (s.envId === null || get(environments).some((e) => e.id === s.envId))) setActiveEnvironment(s.envId);
  void runCollection();
}

// ---- Config setters ----

/** Run scope: folder ids in order (empty = whole tree). A new scope resets the setup's checks and order. */
export function setRunnerFolders(folderIds: string[]): void {
  runnerConfig.update((c) =>
    c.folderIds.join() === folderIds.join() ? c : { ...c, folderIds, excludedIds: [], orderIds: [] },
  );
  persistConfig();
  syncRunnerTabTitle();
}
/** Requests unchecked in the setup list. */
export function setExcluded(excludedIds: string[]): void {
  runnerConfig.update((c) => ({ ...c, excludedIds }));
  persistConfig();
}
/** Custom run order (request ids). */
export function setRunOrder(orderIds: string[]): void {
  runnerConfig.update((c) => ({ ...c, orderIds }));
  persistConfig();
}
export function setIterations(iterations: number): void {
  const n = Number.isFinite(iterations) ? Math.max(1, Math.round(iterations)) : 1;
  runnerConfig.update((c) => ({ ...c, iterations: n }));
  persistConfig();
}
export function setDelay(delayMs: number): void {
  const n = Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0;
  runnerConfig.update((c) => ({ ...c, delayMs: n }));
  persistConfig();
}
export function setStopOnFailure(stopOnFailure: boolean): void {
  runnerConfig.update((c) => ({ ...c, stopOnFailure }));
  persistConfig();
}
export function setSaveResponses(saveResponses: boolean): void {
  runnerConfig.update((c) => ({ ...c, saveResponses }));
  persistConfig();
}

// ---- Presets ----

/** Auto name of a preset: "<scope> · <environment>". */
export function currentPresetName(): string {
  const env = get(environments).find((e) => e.id === get(activeEnvironmentId));
  return `${runnerScopeTitle(get(runnerConfig).folderIds, get(collections))} · ${env?.name ?? get(t)('runner.noEnv')}`;
}

/** Save the current setup as a preset (same name = update); returns its name. */
export function savePreset(): string {
  const c = get(runnerConfig);
  const name = currentPresetName();
  const preset: RunnerPreset = {
    name, folderIds: c.folderIds, excludedIds: c.excludedIds, orderIds: c.orderIds, iterations: c.iterations,
    delayMs: c.delayMs, stopOnFailure: c.stopOnFailure, saveResponses: c.saveResponses, envId: get(activeEnvironmentId),
  };
  runnerPresets.update((l) => upsertPreset(l, preset));
  return name;
}

export function deletePreset(name: string): void {
  runnerPresets.update((l) => l.filter((p) => p.name !== name));
}

/** Restore a preset's setup and open R2. */
export function applyPreset(p: RunnerPreset): void {
  runnerViewing.set(null);
  setRunnerFolders(p.folderIds);
  runnerConfig.update((c) => ({
    ...c, excludedIds: p.excludedIds, orderIds: p.orderIds, iterations: p.iterations, delayMs: p.delayMs,
    stopOnFailure: p.stopOnFailure, saveResponses: p.saveResponses,
  }));
  persistConfig();
  if (p.envId === null || get(environments).some((e) => e.id === p.envId)) setActiveEnvironment(p.envId);
  setRunnerStage('setup');
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
// Exported for stores/flow.ts, which shares the same script-context needs.

/** The active environment's `name → value` map, or `{}` when none is selected. */
export function activeEnvMap(): Record<string, string> {
  const id = get(activeEnvironmentId);
  const env = id ? get(environments).find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
export function globalsMap(): Record<string, string> {
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

/** Resolve the configured folders to the request list to run (none = whole tree). */
export function collectRequests(folderIds: string[], tree: TreeNode[]): RequestNode[] {
  const ids = folderIds.filter((id) => id !== RUNNER_ROOT && findNode(tree, id));
  if (ids.length === 0) return flattenRequests(tree);
  const out = ids.flatMap((id) => flattenRequests([findNode(tree, id)!]));
  return out.filter((n, i) => out.indexOf(n) === i); // a nested pick must not run twice
}

/** Every request in scope, in run order (the setup list, unchecked ones included). */
export function orderedRequests(config: RunnerConfig, tree: TreeNode[]): RequestNode[] {
  const all = collectRequests(config.folderIds, tree);
  const rank = (n: RequestNode) => {
    const i = config.orderIds.indexOf(n.id);
    return i < 0 ? Infinity : i;
  };
  return all.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
}

/** What a run will actually send: the ordered scope minus unchecked requests. */
export function plannedRequests(config: RunnerConfig, tree: TreeNode[]): RequestNode[] {
  return orderedRequests(config, tree).filter((n) => !config.excludedIds.includes(n.id));
}

/** Result of the headless HTTP pipeline (returned, not written to a tab). */
interface HttpRunOutcome {
  status: number;
  elapsedMs: number;
  tests: ScriptTestResult[];
  logs: string[];
  error?: string;
  /** Response body (absent when the pre-request script aborted the send). */
  body?: string;
  size?: number;
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

  return { status: res.status, elapsedMs: res.elapsed_ms, tests, logs, error, body: res.body, size: res.size_bytes };
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
  runnerRun.update((r) => ({ ...r, results: [...r.results, row], completed: r.completed + 1, current: null }));
}

/**
 * Execute one saved HTTP request for iteration `iteration` and return its row.
 * A transport throw becomes an `ok:false` row (never crashes the run).
 * Exported for stores/flow.ts (a Flow request block is one runner row).
 */
export async function runHttpNode(
  node: RequestNode,
  iteration: number,
  iterationData: Record<string, string>,
): Promise<RunResultRow> {
  const scope = runScopeFor(iterationData);
  const finalUrl = buildUrl(node.request.url, node.params);
  const target = resolveVars(finalUrl, scope);
  try {
    const outgoing = buildRequestForSend(withInheritedAuth(node, node.id), finalUrl);
    const out = await runHttp(outgoing, iterationData);
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
      responseBody: out.body,
      nodeId: node.id,
      sizeBytes: out.size,
    };
  } catch (e) {
    return {
      id: crypto.randomUUID(),
      iteration,
      requestName: node.name,
      protocol: 'http',
      method: node.request.method,
      target,
      nodeId: node.id,
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
 * Exported for stores/flow.ts (a Flow request block is one runner row).
 */
export async function runGrpcNode(
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
    nodeId: node.id,
  };
  if (!g || !g.endpoint.trim() || !g.method) {
    return { ...base, status: 'ERR', ok: false, elapsedMs: 0, error: get(t)('runner.err.missingEndpoint') };
  }
  try {
    // Plaintext: honour the saved flag, else infer from the RESOLVED endpoint
    // (the :443 may live inside a {{var}} value).
    const plaintext = g.plaintext !== undefined ? g.plaintext : inferGrpcPlaintext(endpoint);
    const connId = await grpcConnect(endpoint, plaintext, grpcTlsFor(endpoint, g.tls), get(requestTimeoutMs), currentGrpcPrefs());
    // Load the schema so the call can be encoded: proto source compiles files,
    // otherwise reflection lists the services.
    if (g.source === 'proto') {
      const abs = grpcPathsToAbs(g, get(workspacePath));
      await grpcLoadProto(connId, abs?.protoPaths ?? [], withGlobalImports(abs?.importPaths ?? []));
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
    const merged = grpcAuthMetadata(effectiveAuth(get(collections), node.id, g.auth), (v) => resolveVars(v, scope));
    for (const [k, v] of Object.entries(metadata)) merged[k] = resolveVars(v, scope);
    const resolvedMetadata = outgoingGrpcMetadata(merged, stripsAuthorization(g, plaintext));
    const result = await grpcCall(connId, g.method, resolvedMessage, resolvedMetadata, undefined, get(grpcDeadlineMs));

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
      responseBody: result.body,
      sizeBytes: result.size_bytes,
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

const runNode = (node: RequestNode, iteration: number, data: Record<string, string>) =>
  node.protocol === 'grpc' ? runGrpcNode(node, iteration, data) : runHttpNode(node, iteration, data);

/** Close the run and record it in the persisted history. */
function finishRun(status: RunStatus): void {
  runnerRun.update((r) => ({ ...r, status, finishedAt: Date.now(), paused: false, current: null }));
  const r = get(runnerRun);
  if (r.results.length === 0 || r.startedAt === null) return;
  const { folderIds } = get(runnerConfig);
  const envId = get(activeEnvironmentId);
  const summary = {
    ...summarizeRun(r.n, r.startedAt, r.finishedAt ?? Date.now(), r.results),
    title: runnerScopeTitle(folderIds, get(collections)),
    folderIds,
    envId,
    envName: get(environments).find((e) => e.id === envId)?.name,
    iterations: r.iterations,
  };
  const history = pushHistory(get(runnerHistory), summary);
  runnerHistory.set(history);
  void saveState(HISTORY_KEY, history);
  persistRecord();
}

/** Save/refresh the record of the current run (after it finishes and after in-place re-runs). */
function persistRecord(): void {
  const r = get(runnerRun);
  if (r.n === 0 || r.startedAt === null || r.results.length === 0) return;
  const rec = toRecord({ n: r.n, startedAt: r.startedAt, finishedAt: r.finishedAt ?? Date.now(), iterations: r.iterations, results: r.results }, get(runnerConfig).saveResponses);
  const list = pushRecord(get(runnerRecords), rec);
  runnerRecords.set(list);
  void saveState(RECORDS_KEY, list);
}

/**
 * Open a past run read-only (a click on a bar of the "last runs" chart). The latest run is the live
 * one, so it is shown normally; for an older run the re-run actions are off until the latest is
 * restored (click its bar) or a new run starts.
 */
export function viewRun(n: number): void {
  if (get(runnerRun).status === 'running') return;
  const rec = get(runnerRecords).find((r) => r.n === n);
  if (!rec) return;
  const latest = get(runnerHistory).at(-1)?.n;
  runnerRun.set({
    ...DEFAULT_RUN, status: 'done', results: rec.results, total: rec.results.length, completed: rec.results.length,
    startedAt: rec.startedAt, finishedAt: rec.finishedAt, n: rec.n, iterations: rec.iterations,
  });
  runnerViewing.set(n === latest ? null : n);
  setRunnerStage('run');
}

/**
 * Run the configured folders. Determines the iteration count (data rows when a
 * file is loaded, else the numeric setting), streams a row per executed request,
 * and honours stop-on-failure + the inter-request delay. Never throws: a bad
 * request becomes an `ok:false` row. Each row's `startOffsetMs` is measured
 * from its iteration start minus the configured delays (the waterfall).
 */
let stopRequested = false;

/** R3 "Пауза" / "Продолжить": the run halts before its next call. */
export function togglePause(): void {
  runnerRun.update((r) => (r.status === 'running' ? { ...r, paused: !r.paused } : r));
}

/** R3 "Остановить": the call in flight finishes, nothing after it is sent. */
export function stopRun(): void {
  if (get(runnerRun).status === 'running') stopRequested = true;
}

/** Wait out a pause; true when the run should stop instead. */
async function holdOrStop(): Promise<boolean> {
  while (get(runnerRun).paused && !stopRequested) await sleep(100);
  return stopRequested;
}

export async function runCollection(): Promise<void> {
  if (get(runnerRun).status === 'running') return;
  await loadRunnerState();
  setRunnerStage('run');
  stopRequested = false;
  runnerViewing.set(null);
  const config = get(runnerConfig);
  const requests = plannedRequests(config, get(collections));
  const n = (get(runnerHistory).at(-1)?.n ?? 0) + 1;
  if (requests.length === 0) {
    // Nothing to run — surface an empty "done" so the summary/empty state shows.
    runnerRun.set({ ...DEFAULT_RUN, status: 'done', results: [], startedAt: Date.now(), finishedAt: Date.now() });
    return;
  }

  const dataDriven = config.dataRows.length > 0;
  const iterations = dataDriven ? config.dataRows.length : Math.max(1, config.iterations);

  const startedAt = Date.now();
  runnerRun.set({
    ...DEFAULT_RUN,
    status: 'running',
    results: [],
    total: requests.length * iterations,
    startedAt,
    n,
    iterations,
  });

  for (let i = 1; i <= iterations; i++) {
    const iterationData = dataDriven ? (config.dataRows[i - 1] ?? {}) : {};
    const iterStart = performance.now();
    runnerRun.update((r) => ({ ...r, iterStarts: [...r.iterStarts, Date.now() - startedAt] }));
    let paused = 0;
    for (let j = 0; j < requests.length; j++) {
      const t0 = performance.now();
      if (await holdOrStop()) return finishRun('stopped');
      paused += performance.now() - t0;
      const node = requests[j];
      const method = node.protocol === 'grpc' ? 'gRPC' : node.request.method;
      runnerRun.update((r) => ({ ...r, current: { nodeId: node.id, name: node.name, method, startedAt: Date.now() } }));
      const startOffsetMs = Math.round(performance.now() - iterStart - paused);
      const row = { ...(await runNode(node, i, iterationData)), startOffsetMs, endMs: Date.now() - startedAt };
      pushRow(row);

      if (stopRequested || (config.stopOnFailure && !row.ok)) return finishRun('stopped');

      // Delay before the next request; skip after the very last one of the run.
      const isLast = i === iterations && j === requests.length - 1;
      if (config.delayMs > 0 && !isLast) {
        const t = performance.now();
        await sleep(config.delayMs);
        paused += performance.now() - t;
      }
    }
  }

  finishRun('done');
}

/** Re-run `rows` in place (same iteration data, same waterfall slot). */
async function rerunRows(rows: RunResultRow[]): Promise<void> {
  const prevStatus = get(runnerRun).status;
  if (prevStatus === 'running' || rows.length === 0 || get(runnerViewing) !== null) return;
  const config = get(runnerConfig);
  runnerRun.update((r) => ({ ...r, status: 'running' }));
  for (const [k, old] of rows.entries()) {
    const node = old.nodeId ? findNode(get(collections), old.nodeId) : undefined;
    if (node?.kind !== 'request') continue;
    const fresh = await runNode(node, old.iteration, config.dataRows[old.iteration - 1] ?? {});
    const row = { ...fresh, id: old.id, startOffsetMs: old.startOffsetMs };
    runnerRun.update((r) => ({ ...r, results: r.results.map((x) => (x.id === old.id ? row : x)) }));
    if (config.delayMs > 0 && k < rows.length - 1) await sleep(config.delayMs);
  }
  runnerRun.update((r) => ({ ...r, status: prevStatus }));
  persistRecord();
}

/** "Перезапустить упавшие": re-run only the failed calls of the current run. */
export function rerunFailed(): Promise<void> {
  return rerunRows(get(runnerRun).results.filter((r) => !r.ok));
}

/** "Повторить": re-run one call. */
export function rerunCall(rowId: string): Promise<void> {
  return rerunRows(get(runnerRun).results.filter((r) => r.id === rowId));
}

/**
 * "Брать id из …": the source request's test script stores its response `id`
 * in `{{varName}}` (active environment, else globals), and the failing
 * request's URL uses that variable instead of the hard-coded literal.
 */
export async function bindIdFrom(targetNodeId: string, b: IdBinding): Promise<boolean> {
  const root = get(workspacePath);
  const tree = get(collections);
  const src = b.sourceNodeId ? findNode(tree, b.sourceNodeId) : undefined;
  const dst = findNode(tree, targetNodeId);
  if (!root || src?.kind !== 'request' || dst?.kind !== 'request') return false;
  const scope = get(activeEnvironmentId) ? 'environment' : 'globals';
  const line = `pm.${scope}.set('${b.varName}', pm.response.json().id);`;
  const script = src.request.testScript?.trimEnd() ?? '';
  const nodes: RequestNode[] = [
    script.includes(line) ? src : { ...src, request: { ...src.request, testScript: script ? `${script}\n${line}` : line } },
    { ...dst, request: { ...dst.request, url: dst.request.url.split(b.literal).join(`{{${b.varName}}}`) } },
  ];
  try {
    for (const node of nodes) {
      const folder = parentId(node.id);
      await workspaceSaveRequest(root, folder ? idToRel(folder) : ROOT, node.id, node);
    }
    return true;
  } catch (e) {
    console.error('runner: bindIdFrom failed', e);
    return false;
  } finally {
    await reloadWorkspace();
  }
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
      folderIds: config.folderIds,
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
    rows: config.saveResponses ? run.results : run.results.map(({ responseBody: _body, ...row }) => row),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch (e) {
    console.error('runner: exportReport failed', e);
    return false;
  }
}
