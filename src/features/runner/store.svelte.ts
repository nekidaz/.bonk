import { dynamicOptions } from '$shared/settings';
import { untrack } from 'svelte';
import { t } from '$shared/i18n';
import {
  type InputAnswer,
  type InputRequest,
  type Tab,
  type RunResultRow,
  type RunStatus,
  type Scenario,
  scenarioVariables,
} from '$shared/model';
import {
  runnerPause,
  runnerStop,
  workspaceSaveRequest,
  scenariosLoad,
  scenariosSave,
  scenariosDelete,
  type RunVarWrites,
} from '$shared/ipc';
import { findNode, idToRel, parentId, ROOT, refreshDirs, workspace } from '$entities/workspace';
import {
  pushHistory,
  pushRecord,
  summarizeRun,
  toRecord,
  type IdBinding,
  type RunRecord,
  type RunSummary,
} from './runnerStats';
import { isPreset, type RunnerPreset } from './runnerPreset';
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
  runnerScopeTitle,
  type RunnerConfig,
  type RunnerRun,
  type RunnerStage,
} from './runnerPlan';
import { isArrayOf, loadState, saveState, saveStateDebounced } from '$shared/persist';
import { tabs } from '$entities/tab';
import { environments, setActiveEnvironment } from '$entities/environment';
import { answerInput } from '$entities/input';
import { addAppConsoleEntry, runOne, runRequests, captureExecutionContext } from '$entities/request';
import type { RunEvent } from '$shared/ipc';

/**
 * The Collection Runner: runs a whole folder of saved requests (HTTP + gRPC) in
 * sequence, optionally over multiple iterations and/or a CSV/JSON data file,
 * streaming results live. The run itself happens in bonk-core's runner (via
 * `runRequests`); this store keeps its setup, live state and history.
 *
 * Layering: this module depends on `entities/request` (the shared `applyScriptVars`
 * fold + `execute.ts`), `shared/ipc` and pure model helpers only — never the other
 * way round — so the slice graph stays acyclic.
 *
 * Env/globals writes made by scripts persist across the WHOLE run: the runner keeps
 * them for later requests and streams them back into the real stores.
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
  scenarios = $state.raw<Scenario[]>([]);
  activeScenario = $state.raw<Scenario | null>(null);
  error = $state('');
  variables = $state.raw<Scenario['variables'] | null>(null);
  runEnvironmentId: string | null = null;
  #presets = $state.raw<RunnerPreset[]>([]);
  #presetsLoaded = false;

  /** Workspace scenarios plus legacy local presets; same-name workspace setups take precedence. */
  get presets(): RunnerPreset[] {
    const shared = this.scenarios.map((scenario): RunnerPreset => ({
      name: scenario.name,
      folderIds: scenario.paths.map((p) => `fs:${p}`),
      excludedIds: [],
      orderIds: [],
      iterations: scenario.iterations,
      delayMs: scenario.delayMs,
      stopOnFailure: scenario.stopOnFailure,
      saveResponses: true,
      envId: environments.list.find((e) => e.name === scenario.environmentName)?.id ?? null,
      scenario,
    }));
    return [...this.#presets.filter((p) => !shared.some((s) => s.name === p.name)), ...shared];
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

  /** Keep the run-local variables so one-call reruns work without a local environment. */
  updateVariables(writes: RunVarWrites): void {
    const current = untrack(() => this.variables);
    if (!current) return;
    const patch = (values: Record<string, string>, set: Record<string, string>, unset: string[]) => {
      const next = { ...values, ...set };
      for (const key of unset) delete next[key];
      return next;
    };
    this.variables = {
      environment: patch(current.environment, writes.envSet, writes.envUnset),
      globals: patch(current.globals, writes.globalsSet, writes.globalsUnset),
    };
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
  runner.activeScenario = null;
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
/** A step that needs typed input: wait for a person, or fail (for CI). */
export function setInputMode(inputMode: 'wait' | 'fail'): void {
  runner.updateConfig((c) => ({ ...c, inputMode }));
  persistConfig();
}

// ---- Presets ----

/** Auto name of a preset: "<scope> · <environment>". */
export function currentPresetName(): string {
  const env = environments.active;
  return `${runnerScopeTitle(runner.config.folderIds, workspace.tree)} · ${env?.name ?? t('runner.noEnv')}`;
}

/** Save the current setup as a preset (same name = update); returns its name. */
export async function savePreset(): Promise<string> {
  runner.error = '';
  const c = runner.config;
  const prior = runner.activeScenario;
  const name = prior?.name ?? currentPresetName();
  const root = workspace.path;
  if (!root) throw new Error(t('runner.preset.workspaceRequired'));
  const defaults = scenarioVariables(environments.globals, environments.active?.vars ?? []);
  const requiredNames = new Set(prior?.requiredVariables ?? []);
  for (const key of [...Object.keys(defaults.variables.globals), ...Object.keys(defaults.variables.environment)])
    requiredNames.delete(key);
  for (const key of defaults.requiredVariables) requiredNames.add(key);
  const required = [...requiredNames];
  const variables = {
    globals: { ...prior?.variables.globals, ...defaults.variables.globals },
    environment: { ...prior?.variables.environment, ...defaults.variables.environment },
  };
  for (const key of required) {
    delete variables.globals[key];
    delete variables.environment[key];
  }
  const scenario: Scenario = {
    name,
    paths: plannedRequests(c, workspace.tree).map((n) => idToRel(n.id)),
    variables,
    requiredVariables: required,
    environmentName: environments.active?.name ?? null,
    iterations: c.iterations,
    dynamic: prior?.dynamic ?? dynamicOptions(),
    dataRows: c.dataRows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !required.includes(key))),
    ),
    delayMs: c.delayMs,
    stopOnFailure: c.stopOnFailure,
  };
  await scenariosSave(root, scenario);
  const list = await scenariosLoad(root);
  if (workspace.path === root) {
    runner.scenarios = list;
    runner.activeScenario = scenario;
  }
  return name;
}

export async function deletePreset(name: string): Promise<void> {
  runner.error = '';
  const root = workspace.path;
  try {
    if (runner.scenarios.some((s) => s.name === name) && root) {
      await scenariosDelete(root, name);
      const list = await scenariosLoad(root);
      if (workspace.path === root) {
        runner.scenarios = list;
        if (runner.activeScenario?.name === name) runner.activeScenario = null;
      }
    }
    runner.presets = runner.presets.filter((p) => p.name !== name && !p.scenario);
  } catch (e) {
    runner.error = String(e);
  }
}

/** Workspace changes reload shared setups; lifecycle owns this watcher. */
export function watchRunnerWorkspace(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const root = workspace.path;
      runner.scenarios = [];
      runner.activeScenario = null;
      if (!root) return;
      let cancelled = false;
      void scenariosLoad(root)
        .then((list) => {
          if (!cancelled) runner.scenarios = list;
        })
        .catch((e) => {
          if (!cancelled) runner.error = String(e);
        });
      return () => {
        cancelled = true;
      };
    });
  });
}

/** Restore a preset's setup and open R2. */
export function applyPreset(p: RunnerPreset): void {
  runner.viewing = null;
  setRunnerFolders(p.folderIds);
  runner.updateConfig((c) => ({
    ...applyPresetSettings(c, p),
    dataRows: p.scenario?.dataRows ?? [],
    dataFileName: null,
  }));
  runner.activeScenario = p.scenario ?? null;
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

/** The run stops at a step and waits for typed input (again, after a rejected value). */
function waitForInput(request: InputRequest): void {
  runner.updateRun((r) => ({
    ...r,
    waiting: { request, since: Date.now() },
    retries: request.attempt > 1 ? r.retries + 1 : r.retries,
  }));
}

/** Reply to the open form; the run goes on (or ends, on «stop»). */
export async function answerWaiting(answer: InputAnswer): Promise<void> {
  const waiting = runner.run.waiting;
  if (!waiting) return;
  runner.updateRun((r) => ({ ...r, waiting: null, waitedMs: r.waitedMs + (Date.now() - waiting.since) }));
  try {
    await answerInput(waiting.request, answer);
  } catch (e) {
    runner.error = String(e);
  }
}

/** Events a run streams besides rows; shared by a whole run and an in-place re-run. */
function onRunEvent(e: RunEvent): void {
  if (e.kind === 'vars') runner.updateVariables(e);
  else if (e.kind === 'iteration') runner.updateRun((r) => ({ ...r, iterStarts: [...r.iterStarts, e.atMs] }));
  else if (e.kind === 'call')
    runner.updateRun((r) => ({
      ...r,
      current: { nodeId: e.nodeId, name: e.name, method: e.method, startedAt: Date.now() },
    }));
  else if (e.kind === 'input') waitForInput(e);
  else if (e.kind === 'row') {
    const { kind: _kind, ...row } = e;
    pushRow(row);
  }
}

/** Append a streamed result row (new array so Svelte reactivity fires). */
function pushRow(row: RunResultRow): void {
  runner.updateRun((r) => ({
    ...r,
    results: [...r.results, row],
    completed: r.completed + 1,
    current: null,
    waiting: null,
  }));
  // Flow · Консоль: Runner sends share the request feed.
  addAppConsoleEntry({
    protocol: row.protocol,
    method: row.method,
    url: row.target,
    ok: row.ok,
    status: String(row.status),
    elapsedMs: row.elapsedMs,
    message: row.error,
    logs: row.logs,
    tests: row.tests,
    scripted: row.tests.length > 0 || row.logs.length > 0,
    title: row.requestName,
    nodeId: row.nodeId,
    runner: true,
  });
}

/** Close the run and record it in the persisted history. */
function finishRun(status: RunStatus): void {
  runner.updateRun((r) => ({ ...r, status, finishedAt: Date.now(), paused: false, current: null, waiting: null }));
  const r = runner.run;
  if (r.results.length === 0 || r.startedAt === null) return;
  const { folderIds } = runner.config;
  const envId = runner.runEnvironmentId;
  const summary = {
    // The time a person took to type is not the API's time: kept out of the duration.
    ...summarizeRun(r.n, r.startedAt, (r.finishedAt ?? Date.now()) - r.waitedMs, r.results),
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

/** The live run's id in the Rust runner (pause / stop). */
let runId = '';

/** R3 "Пауза" / "Продолжить": the run halts before its next call. */
export function togglePause(): void {
  if (runner.run.status !== 'running') return;
  runner.updateRun((r) => ({ ...r, paused: !r.paused }));
  void runnerPause(runId, runner.run.paused);
}

/** R3 "Остановить": the call in flight finishes, nothing after it is sent. */
export function stopRun(): void {
  if (runner.run.status === 'running') void runnerStop(runId);
}

/**
 * Run the configured folders: the iteration count (data rows when a file is loaded,
 * else the numeric setting), stop-on-failure and the delay go to the runner, which
 * streams a row per executed request (`startOffsetMs` = the waterfall slot). Never
 * throws: a bad request is an `ok:false` row.
 */
export async function runCollection(): Promise<void> {
  if (runner.run.status === 'running') return;
  await loadRunnerState();
  runner.error = '';
  setRunnerStage('run');
  runner.viewing = null;
  const config = runner.config;
  const scenario = runner.activeScenario;
  const missing = scenario?.paths.find((path) => !findNode(workspace.tree, `fs:${path}`));
  if (missing) {
    runner.error = t('runner.scenario.missingPath', { path: missing });
    setRunnerStage('setup');
    return;
  }
  const requests = plannedRequests(config, workspace.tree);
  const n = (runner.history.at(-1)?.n ?? 0) + 1;
  if (requests.length === 0) {
    // Nothing to run — surface an empty "done" so the summary/empty state shows.
    runner.run = { ...DEFAULT_RUN, status: 'done', results: [], startedAt: Date.now(), finishedAt: Date.now() };
    return;
  }

  const iterations = iterationCount(config);
  const context = captureExecutionContext();
  runner.runEnvironmentId = context.environmentId;
  runner.variables = {
    environment: { ...scenario?.variables.environment, ...context.variables.environment },
    globals: { ...context.variables.globals, ...scenario?.variables.globals },
  };

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

  runId = crypto.randomUUID();
  let status: 'done' | 'stopped' = 'done';
  try {
    status = await runRequests(
      requests,
      {
        runId,
        dynamic: scenario?.dynamic,
        variables: scenario?.variables,
        requiredVariables: scenario?.requiredVariables,
        iterations: config.iterations,
        dataRows: config.dataRows,
        delayMs: config.delayMs,
        stopOnFailure: config.stopOnFailure,
        inputMode: config.inputMode,
      },
      onRunEvent,
    );
  } catch (e) {
    runner.error = String(e);
    console.error('runner: run failed', e);
    setRunnerStage('setup');
    status = 'stopped';
  }
  finishRun(status);
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
    const fresh = await runOne(node, old.iteration, config.dataRows[old.iteration - 1] ?? {}, {
      dynamic: runner.activeScenario?.dynamic,
      variables: runner.variables ?? runner.activeScenario?.variables,
      requiredVariables: runner.activeScenario?.requiredVariables,
      inputMode: config.inputMode,
      onInput: waitForInput,
    });
    const row = { ...fresh, id: old.id, startOffsetMs: old.startOffsetMs, endMs: old.endMs };
    runner.updateRun((r) => ({ ...r, results: r.results.map((x) => (x.id === old.id ? row : x)) }));
    if (config.delayMs > 0 && k < rows.length - 1) await new Promise((done) => setTimeout(done, config.delayMs));
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
    await refreshDirs(...nodes.map((n) => parentId(n.id)));
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
