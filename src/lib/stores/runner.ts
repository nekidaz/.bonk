import { get, writable } from 'svelte/store';
import { t } from '../i18n';
import type { Tab, RunResultRow, RunStatus } from '../domain/types';
import { workspaceSaveRequest } from '../api';
import { findNode, idToRel, parentId } from '../domain/tree';
import { pushHistory, pushRecord, summarizeRun, toRecord, type IdBinding, type RunRecord, type RunSummary } from '../domain/runnerStats';
import { isPreset, upsertPreset, type RunnerPreset } from '../domain/runnerPreset';
import {
  DEFAULT_CONFIG, DEFAULT_RUN, RUNNER_ROOT, applyPresetSettings, bindIdNodes, buildReport, clampDelay, clampIterations,
  collectRequests, isRecord, isSummary, iterationCount, mergeSavedConfig, orderedRequests, persistedConfig, plannedRequests,
  presetFrom, runnerScopeTitle,
  type RunnerConfig, type RunnerRun, type RunnerStage,
} from '../domain/runnerPlan';
import { isArrayOf, loadState, saveState, saveStateDebounced } from '../persist';
import { tabs, activeTabId, collections, workspacePath, environments, activeEnvironmentId, ROOT } from './state';
import { reloadWorkspace } from './workspace';
import { setActiveEnvironment } from './environments';
import { runNode } from './runnerExec';

// Re-exported so every existing `./runner` import (the barrel, stores/flow.ts) keeps working.
export { activeEnvMap, globalsMap, runHttpNode, runGrpcNode } from './runnerExec';
export { RUNNER_ROOT, runnerScopeTitle, collectRequests, orderedRequests, plannedRequests };
export type { RunnerConfig, RunnerRun, RunnerStage };

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
    runnerConfig.update((cur) => mergeSavedConfig(cur, saved));
    runnerHistory.set(hist);
    runnerRecords.set(records);
    runnerPresets.set(presets);
    runnerPresets.subscribe((list) => saveStateDebounced(PRESETS_KEY, list)); // only after the load, so [] can't wipe it
    syncRunnerTabTitle();
  })();
  return loaded;
}

function persistConfig(): void {
  saveStateDebounced(CONFIG_KEY, persistedConfig(get(runnerConfig)));
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
  runnerConfig.update((c) => ({ ...c, iterations: clampIterations(iterations) }));
  persistConfig();
}
export function setDelay(delayMs: number): void {
  runnerConfig.update((c) => ({ ...c, delayMs: clampDelay(delayMs) }));
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
  runnerPresets.update((l) => upsertPreset(l, presetFrom(c, name, get(activeEnvironmentId))));
  return name;
}

export function deletePreset(name: string): void {
  runnerPresets.update((l) => l.filter((p) => p.name !== name));
}

/** Restore a preset's setup and open R2. */
export function applyPreset(p: RunnerPreset): void {
  runnerViewing.set(null);
  setRunnerFolders(p.folderIds);
  runnerConfig.update((c) => applyPresetSettings(c, p));
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

/** Sleep helper for the inter-request delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append a streamed result row (new array so Svelte reactivity fires). */
function pushRow(row: RunResultRow): void {
  runnerRun.update((r) => ({ ...r, results: [...r.results, row], completed: r.completed + 1, current: null }));
}

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
  const iterations = iterationCount(config);

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
  const nodes = bindIdNodes(src, dst, b, !!get(activeEnvironmentId));
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
  const report = buildReport(get(runnerConfig), get(runnerRun));
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch (e) {
    console.error('runner: exportReport failed', e);
    return false;
  }
}
