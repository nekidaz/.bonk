import { untrack } from 'svelte';
import { t } from '$shared/i18n';
import type { Tab, RunResultRow, RunStatus } from '$shared/model';
import { workspaceSaveRequest } from '$shared/ipc';
import { findNode, idToRel, parentId, ROOT, reloadWorkspace, workspace } from '$entities/workspace';
import {
  pushHistory,
  pushRecord,
  summarizeRun,
  toRecord,
  type IdBinding,
  type RunRecord,
  type RunSummary,
} from './runnerStats';
import { isPreset, upsertPreset, type RunnerPreset } from './runnerPreset';
import {
  DEFAULT_CONFIG,
  DEFAULT_RUN,
  RUNNER_ROOT,
  applyPresetSettings,
  bindIdNodes,
  buildReport,
  clampDelay,
  clampIterations,
  collectRequests,
  isRecord,
  isSummary,
  iterationCount,
  mergeSavedConfig,
  orderedRequests,
  persistedConfig,
  plannedRequests,
  presetFrom,
  runnerScopeTitle,
  type RunnerConfig,
  type RunnerRun,
  type RunnerStage,
} from './runnerPlan';
import { isArrayOf, loadState, saveState, saveStateDebounced } from '$shared/persist';
import { tabs } from '$entities/tab';
import { environments, setActiveEnvironment } from '$entities/environment';
import { runNode } from '$entities/request';

/**
 * The Collection Runner: runs a whole folder of saved requests (HTTP + gRPC) in
 * sequence, optionally over multiple iterations and/or a CSV/JSON data file,
 * streaming results live. It reuses the interactive send + script pipeline
 * (mirroring `sendHttpRequest`) but returns data rather than writing to a tab.
 *
 * Layering: this module depends on `entities/request` (the shared `applyScriptVars`
 * fold + `execute.ts`), `shared/ipc` and pure model helpers only — never the other
 * way round — so the slice graph stays acyclic.
 *
 * Env/globals writes made by scripts persist across the WHOLE run: each request
 * folds its writes into the real stores via `applyScriptVars`, and every request
 * recomputes its env/globals maps FRESH (read at that moment) so a later request
 * sees an earlier one's writes.
 */

const PRESETS_KEY = 'runnerPresets';

class Runner {
  config = $state.raw<RunnerConfig>({ ...DEFAULT_CONFIG });
  run = $state.raw<RunnerRun>({ ...DEFAULT_RUN, results: [] });
  /** Last HISTORY_LIMIT finished runs (app state, not the workspace). */
  history = $state.raw<RunSummary[]>([]);
  stage = $state<RunnerStage>('pick');
  /** Per-call results of the last HISTORY_LIMIT runs, so a past run can be reopened (R4 bars). */
  records = $state.raw<RunRecord[]>([]);
  /** Run number shown read-only in the run view (an older run); null = the latest / live run. */
  viewing = $state<number | null>(null);
  #presets = $state.raw<RunnerPreset[]>([]);
  #presetsLoaded = false;

  /** Saved setups (R2 «Сохранить как пресет»), loaded from the R1 list. Saved on every change once loaded. */
  get presets(): RunnerPreset[] {
    return this.#presets;
  }

  set presets(list: RunnerPreset[]) {
    this.#presets = list;
    if (this.#presetsLoaded) saveStateDebounced(PRESETS_KEY, list); // only after the load, so [] can't wipe it
  }

  /** Set the loaded presets and start saving later changes. */
  loadPresets(list: RunnerPreset[]): void {
    this.#presetsLoaded = true;
    this.presets = list;
  }

  /** Replace the config with `fn(config)`; reads untracked. */
  updateConfig(fn: (c: RunnerConfig) => RunnerConfig): void {
    this.config = fn(untrack(() => this.config));
  }

  /** Replace the run state with `fn(run)`; reads untracked. */
  updateRun(fn: (r: RunnerRun) => RunnerRun): void {
    this.run = fn(untrack(() => this.run));
  }
}
export const runner = new Runner();

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
    runner.updateConfig((cur) => mergeSavedConfig(cur, saved));
    runner.history = hist;
    runner.records = records;
    runner.loadPresets(presets);
    syncRunnerTabTitle();
  })();
  return loaded;
}

function persistConfig(): void {
  saveStateDebounced(CONFIG_KEY, persistedConfig(runner.config));
}

/** Keep the runner tab named "Runner · <scope>". */
function syncRunnerTabTitle(): void {
  const title =
    runner.stage === 'pick'
      ? t('runner.tab.new')
      : `Runner · ${runnerScopeTitle(runner.config.folderIds, workspace.tree)}`;
  if (tabs.list.some((t) => t.protocol === 'runner' && t.title !== title)) {
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
  const existing = tabs.list.find((t) => t.protocol === 'runner');
  if (existing) {
    tabs.activeId = existing.id;
    syncRunnerTabTitle();
    return;
  }
  if (runner.run.n === 0) runner.stage = 'pick';
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'runner',
    title: 'Runner',
    manualTitle: true,
    request: { method: 'RUN', url: '', headers: {} },
  };
  tabs.update((list) => [...list, tab]);
  tabs.activeId = tab.id;
  syncRunnerTabTitle();
}

/** Switch the Runner screen (R1 pick / R2 setup / R3-R4 run). */
export function setRunnerStage(stage: RunnerStage): void {
  runner.stage = stage;
  syncRunnerTabTitle();
}

/** Tree context menu "Запустить в Runner": scope to the folder and open its setup (R2). */
export function runInRunner(folderId: string): void {
  setRunnerFolders([folderId]);
  runner.stage = 'setup';
  openRunnerTab();
}

/** R1 "repeat a recent run": restore its scope, iterations and environment, then run. */
export function repeatRun(s: RunSummary): void {
  if (s.folderIds) setRunnerFolders(s.folderIds);
  if (s.iterations && runner.config.dataRows.length === 0) setIterations(s.iterations);
  if (s.envId !== undefined && (s.envId === null || environments.list.some((e) => e.id === s.envId)))
    setActiveEnvironment(s.envId);
  void runCollection();
}

// ---- Config setters ----

/** Run scope: folder ids in order (empty = whole tree). A new scope resets the setup's checks and order. */
export function setRunnerFolders(folderIds: string[]): void {
  runner.updateConfig((c) =>
    c.folderIds.join() === folderIds.join() ? c : { ...c, folderIds, excludedIds: [], orderIds: [] },
  );
  persistConfig();
  syncRunnerTabTitle();
}
/** Requests unchecked in the setup list. */
export function setExcluded(excludedIds: string[]): void {
  runner.updateConfig((c) => ({ ...c, excludedIds }));
  persistConfig();
}
/** Custom run order (request ids). */
export function setRunOrder(orderIds: string[]): void {
  runner.updateConfig((c) => ({ ...c, orderIds }));
  persistConfig();
}
export function setIterations(iterations: number): void {
  runner.updateConfig((c) => ({ ...c, iterations: clampIterations(iterations) }));
  persistConfig();
}
export function setDelay(delayMs: number): void {
  runner.updateConfig((c) => ({ ...c, delayMs: clampDelay(delayMs) }));
  persistConfig();
}
export function setStopOnFailure(stopOnFailure: boolean): void {
  runner.updateConfig((c) => ({ ...c, stopOnFailure }));
  persistConfig();
}
export function setSaveResponses(saveResponses: boolean): void {
  runner.updateConfig((c) => ({ ...c, saveResponses }));
  persistConfig();
}

// ---- Presets ----

/** Auto name of a preset: "<scope> · <environment>". */
export function currentPresetName(): string {
  const env = environments.active;
  return `${runnerScopeTitle(runner.config.folderIds, workspace.tree)} · ${env?.name ?? t('runner.noEnv')}`;
}

/** Save the current setup as a preset (same name = update); returns its name. */
export function savePreset(): string {
  const c = runner.config;
  const name = currentPresetName();
  runner.presets = upsertPreset(runner.presets, presetFrom(c, name, environments.activeId));
  return name;
}

export function deletePreset(name: string): void {
  runner.presets = runner.presets.filter((p) => p.name !== name);
}

/** Restore a preset's setup and open R2. */
export function applyPreset(p: RunnerPreset): void {
  runner.viewing = null;
  setRunnerFolders(p.folderIds);
  runner.updateConfig((c) => applyPresetSettings(c, p));
  persistConfig();
  if (p.envId === null || environments.list.some((e) => e.id === p.envId)) setActiveEnvironment(p.envId);
  setRunnerStage('setup');
}

/** Load a parsed data file: makes the run data-driven (rows.length iterations). */
export function loadDataRows(name: string, rows: Record<string, string>[]): void {
  runner.updateConfig((c) => ({ ...c, dataFileName: name, dataRows: rows }));
}
/** Clear the loaded data file, reverting to the numeric iteration count. */
export function clearData(): void {
  runner.updateConfig((c) => ({ ...c, dataFileName: null, dataRows: [] }));
}

/** Sleep helper for the inter-request delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append a streamed result row (new array so Svelte reactivity fires). */
function pushRow(row: RunResultRow): void {
  runner.updateRun((r) => ({ ...r, results: [...r.results, row], completed: r.completed + 1, current: null }));
}

/** Close the run and record it in the persisted history. */
function finishRun(status: RunStatus): void {
  runner.updateRun((r) => ({ ...r, status, finishedAt: Date.now(), paused: false, current: null }));
  const r = runner.run;
  if (r.results.length === 0 || r.startedAt === null) return;
  const { folderIds } = runner.config;
  const envId = environments.activeId;
  const summary = {
    ...summarizeRun(r.n, r.startedAt, r.finishedAt ?? Date.now(), r.results),
    title: runnerScopeTitle(folderIds, workspace.tree),
    folderIds,
    envId,
    envName: environments.list.find((e) => e.id === envId)?.name,
    iterations: r.iterations,
  };
  const history = pushHistory(runner.history, summary);
  runner.history = history;
  void saveState(HISTORY_KEY, history);
  persistRecord();
}

/** Save/refresh the record of the current run (after it finishes and after in-place re-runs). */
function persistRecord(): void {
  const r = runner.run;
  if (r.n === 0 || r.startedAt === null || r.results.length === 0) return;
  const rec = toRecord(
    {
      n: r.n,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? Date.now(),
      iterations: r.iterations,
      results: r.results,
    },
    runner.config.saveResponses,
  );
  const list = pushRecord(runner.records, rec);
  runner.records = list;
  void saveState(RECORDS_KEY, list);
}

/**
 * Open a past run read-only (a click on a bar of the "last runs" chart). The latest run is the live
 * one, so it is shown normally; for an older run the re-run actions are off until the latest is
 * restored (click its bar) or a new run starts.
 */
export function viewRun(n: number): void {
  if (runner.run.status === 'running') return;
  const rec = runner.records.find((r) => r.n === n);
  if (!rec) return;
  const latest = runner.history.at(-1)?.n;
  runner.run = {
    ...DEFAULT_RUN,
    status: 'done',
    results: rec.results,
    total: rec.results.length,
    completed: rec.results.length,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    n: rec.n,
    iterations: rec.iterations,
  };
  runner.viewing = n === latest ? null : n;
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
  runner.updateRun((r) => (r.status === 'running' ? { ...r, paused: !r.paused } : r));
}

/** R3 "Остановить": the call in flight finishes, nothing after it is sent. */
export function stopRun(): void {
  if (runner.run.status === 'running') stopRequested = true;
}

/** Wait out a pause; true when the run should stop instead. */
async function holdOrStop(): Promise<boolean> {
  while (runner.run.paused && !stopRequested) await sleep(100);
  return stopRequested;
}

export async function runCollection(): Promise<void> {
  if (runner.run.status === 'running') return;
  await loadRunnerState();
  setRunnerStage('run');
  stopRequested = false;
  runner.viewing = null;
  const config = runner.config;
  const requests = plannedRequests(config, workspace.tree);
  const n = (runner.history.at(-1)?.n ?? 0) + 1;
  if (requests.length === 0) {
    // Nothing to run — surface an empty "done" so the summary/empty state shows.
    runner.run = { ...DEFAULT_RUN, status: 'done', results: [], startedAt: Date.now(), finishedAt: Date.now() };
    return;
  }

  const dataDriven = config.dataRows.length > 0;
  const iterations = iterationCount(config);

  const startedAt = Date.now();
  runner.run = {
    ...DEFAULT_RUN,
    status: 'running',
    results: [],
    total: requests.length * iterations,
    startedAt,
    n,
    iterations,
  };

  for (let i = 1; i <= iterations; i++) {
    const iterationData = dataDriven ? (config.dataRows[i - 1] ?? {}) : {};
    const iterStart = performance.now();
    runner.updateRun((r) => ({ ...r, iterStarts: [...r.iterStarts, Date.now() - startedAt] }));
    let paused = 0;
    for (let j = 0; j < requests.length; j++) {
      const t0 = performance.now();
      if (await holdOrStop()) return finishRun('stopped');
      paused += performance.now() - t0;
      const node = requests[j];
      const method = node.protocol === 'grpc' ? 'gRPC' : node.request.method;
      runner.updateRun((r) => ({ ...r, current: { nodeId: node.id, name: node.name, method, startedAt: Date.now() } }));
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
  const prevStatus = runner.run.status;
  if (prevStatus === 'running' || rows.length === 0 || runner.viewing !== null) return;
  const config = runner.config;
  runner.updateRun((r) => ({ ...r, status: 'running' }));
  for (const [k, old] of rows.entries()) {
    const node = old.nodeId ? findNode(workspace.tree, old.nodeId) : undefined;
    if (node?.kind !== 'request') continue;
    const fresh = await runNode(node, old.iteration, config.dataRows[old.iteration - 1] ?? {});
    const row = { ...fresh, id: old.id, startOffsetMs: old.startOffsetMs };
    runner.updateRun((r) => ({ ...r, results: r.results.map((x) => (x.id === old.id ? row : x)) }));
    if (config.delayMs > 0 && k < rows.length - 1) await sleep(config.delayMs);
  }
  runner.updateRun((r) => ({ ...r, status: prevStatus }));
  persistRecord();
}

/** "Перезапустить упавшие": re-run only the failed calls of the current run. */
export function rerunFailed(): Promise<void> {
  return rerunRows(runner.run.results.filter((r) => !r.ok));
}

/** "Повторить": re-run one call. */
export function rerunCall(rowId: string): Promise<void> {
  return rerunRows(runner.run.results.filter((r) => r.id === rowId));
}

/**
 * "Брать id из …": the source request's test script stores its response `id`
 * in `{{varName}}` (active environment, else globals), and the failing
 * request's URL uses that variable instead of the hard-coded literal.
 */
export async function bindIdFrom(targetNodeId: string, b: IdBinding): Promise<boolean> {
  const root = workspace.path;
  const tree = workspace.tree;
  const src = b.sourceNodeId ? findNode(tree, b.sourceNodeId) : undefined;
  const dst = findNode(tree, targetNodeId);
  if (!root || src?.kind !== 'request' || dst?.kind !== 'request') return false;
  const nodes = bindIdNodes(src, dst, b, !!environments.activeId);
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
  const report = buildReport(runner.config, runner.run);
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch (e) {
    console.error('runner: exportReport failed', e);
    return false;
  }
}
