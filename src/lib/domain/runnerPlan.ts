/**
 * Pure Collection Runner logic: config/run shapes and defaults, scope → request
 * planning, settings clamping/merging, the exported report and the «Брать id из …»
 * edit plan. No store reads/writes, no IPC — stores/runner.ts wires these in.
 */
import { get } from 'svelte/store';
import { t, type Translate } from '../i18n';
import type { RequestNode, RunResultRow, RunStatus, ScriptTestResult, TreeNode } from './types';
import type { IdBinding, RunRecord, RunSummary } from './runnerStats';
import type { RunnerPreset } from './runnerPreset';
import { findNode } from './tree';

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

export const DEFAULT_CONFIG: RunnerConfig = {
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

export const DEFAULT_RUN: RunnerRun = {
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

export const isRecord = (v: unknown): v is RunRecord =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as RunRecord).n === 'number' &&
  Array.isArray((v as RunRecord).results);
export const isSummary = (v: unknown): v is RunSummary =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as RunSummary).n === 'number' &&
  typeof (v as RunSummary).durationMs === 'number';

/** Overlay the persisted config (untrusted shape) on the current one. */
export function mergeSavedConfig(cur: RunnerConfig, saved: unknown): RunnerConfig {
  const c = (typeof saved === 'object' && saved ? saved : {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    ...cur,
    folderIds: Array.isArray(c.folderIds) ? ids(c.folderIds) : cur.folderIds,
    excludedIds: ids(c.excludedIds),
    orderIds: ids(c.orderIds),
    iterations: typeof c.iterations === 'number' ? c.iterations : cur.iterations,
    delayMs: typeof c.delayMs === 'number' ? c.delayMs : cur.delayMs,
    stopOnFailure: typeof c.stopOnFailure === 'boolean' ? c.stopOnFailure : cur.stopOnFailure,
    saveResponses: typeof c.saveResponses === 'boolean' ? c.saveResponses : cur.saveResponses,
  };
}

/** The persisted subset of the config (no data file). */
export function persistedConfig(c: RunnerConfig) {
  const { folderIds, iterations, delayMs, stopOnFailure, excludedIds, orderIds, saveResponses } = c;
  return { folderIds, iterations, delayMs, stopOnFailure, excludedIds, orderIds, saveResponses };
}

/** Iteration count setting: a positive integer (non-finite → 1). */
export const clampIterations = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
/** Inter-request delay setting: a non-negative integer of ms (non-finite → 0). */
export const clampDelay = (ms: number): number => (Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0);

/** Iterations a run will do: one per data row when a file is loaded, else the numeric setting. */
export const iterationCount = (c: Pick<RunnerConfig, 'dataRows' | 'iterations'>): number =>
  c.dataRows.length > 0 ? c.dataRows.length : Math.max(1, c.iterations);

/** Header title of the run scope: the first chosen folder, else "Все запросы". */
export function runnerScopeTitle(folderIds: string[], tree: TreeNode[], tr: Translate = get(t)): string {
  for (const id of folderIds) {
    const node = findNode(tree, id);
    if (node) return node.name;
  }
  return tr('runner.allRequests');
}

/** Flatten request nodes in tree order (depth-first, folder order preserved). */
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
  return all
    .map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
    .map((x) => x.n);
}

/** What a run will actually send: the ordered scope minus unchecked requests. */
export function plannedRequests(config: RunnerConfig, tree: TreeNode[]): RequestNode[] {
  return orderedRequests(config, tree).filter((n) => !config.excludedIds.includes(n.id));
}

/** True when every recorded test passed (vacuously true with no tests). */
export function allTestsPassed(tests: ScriptTestResult[]): boolean {
  return tests.every((t) => t.passed);
}

/** Snapshot the setup as a preset. */
export function presetFrom(c: RunnerConfig, name: string, envId: string | null): RunnerPreset {
  return {
    name,
    folderIds: c.folderIds,
    excludedIds: c.excludedIds,
    orderIds: c.orderIds,
    iterations: c.iterations,
    delayMs: c.delayMs,
    stopOnFailure: c.stopOnFailure,
    saveResponses: c.saveResponses,
    envId,
  };
}

/** Overlay a preset's run settings (not its scope or env) on the config. */
export function applyPresetSettings(c: RunnerConfig, p: RunnerPreset): RunnerConfig {
  return {
    ...c,
    excludedIds: p.excludedIds,
    orderIds: p.orderIds,
    iterations: p.iterations,
    delayMs: p.delayMs,
    stopOnFailure: p.stopOnFailure,
    saveResponses: p.saveResponses,
  };
}

/** JSON-serialisable report of a run (bodies dropped unless `saveResponses`). */
export function buildReport(config: RunnerConfig, run: RunnerRun) {
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    config: {
      folderIds: config.folderIds,
      iterations: iterationCount(config),
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
}

/**
 * «Брать id из …» edits: the source node's test script stores its response `id`
 * in `{{varName}}` (environment, else globals) and the target's URL uses that
 * variable instead of the literal. Returns the nodes to save, source first.
 */
export function bindIdNodes(src: RequestNode, dst: RequestNode, b: IdBinding, hasEnv: boolean): RequestNode[] {
  const scope = hasEnv ? 'environment' : 'globals';
  const line = `pm.${scope}.set('${b.varName}', pm.response.json().id);`;
  const script = src.request.testScript?.trimEnd() ?? '';
  return [
    script.includes(line)
      ? src
      : { ...src, request: { ...src.request, testScript: script ? `${script}\n${line}` : line } },
    { ...dst, request: { ...dst.request, url: dst.request.url.split(b.literal).join(`{{${b.varName}}}`) } },
  ];
}
