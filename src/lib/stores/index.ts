/**
 * Public store surface. This barrel re-exports the same symbols the old
 * monolithic `stores.ts` exposed, so consumers keep importing from `./stores`
 * unchanged. New code may import the focused modules directly.
 */

// Pure tab helpers (moved to domain/tab); only the previously-public ones.
export { HTTP_DEFAULT_TITLE, GRPC_DEFAULT_TITLE, titleFromUrl, grpcSnapshot } from '../domain/tab';

// Core store singletons + lowest-level mutators.
export {
  tabs,
  activeTabId,
  history,
  historyLimit,
  historyPaused,
  responseLineWrap,
  requestTimeoutMs,
  requestFollowRedirects,
  requestValidateTls,
  responseBodyLimitMb,
  collections,
  workspacePath,
  recentWorkspacePaths,
  globals,
  environments,
  activeEnvironmentId,
  flows,
  currentVarScope,
  confirmState,
  requestConfirm,
  updateActiveTab,
  updateTabById,
} from './state';

// Environment + variable CRUD (plus the Environments manager tab).
export {
  addEnvironment,
  renameEnvironment,
  deleteEnvironment,
  setActiveEnvironment,
  setEnvVars,
  setGlobalVars,
  openEnvironmentsTab,
} from './environments';

// Persistence / hydration.
export { hydrate } from './persistence';

// Flows (node-graph orchestration).
export {
  flowRun,
  cancelFlowRun,
  createFlow,
  renameFlow,
  deleteFlow,
  updateFlow,
  openFlowTab,
  runFlow,
  defaultBlockConfig,
} from './flow';

// Workspace + tree mutations.
export {
  openWorkspaceFolder,
  switchWorkspace,
  addFolder,
  removeNode,
  renameNode,
  toggleFolder,
  duplicateNode,
  moveNode,
} from './workspace';

// Request save/open/send.
export {
  currentRequestSettings,
  saveActiveRequest,
  addRequestToFolder,
  openSavedRequest,
  applyCurlToActiveTab,
  sendHttpRequest,
  applyScriptVars,
} from './requests';

// Tab lifecycle.
export { renameActiveTab, resetActiveTabTitle, newTab, setActiveProtocol, closeTab, duplicateTab, closeOtherTabs, closeAllTabs } from './tabs';

// Git diff tabs.
export { openGitDiffTab, openProjectDiffTab } from './git';

// Collection Runner (the runner tab, config setters, orchestrator, export).
export {
  runnerConfig,
  runnerRun,
  RUNNER_ROOT,
  openRunnerTab,
  setRunnerFolder,
  setIterations,
  setDelay,
  setStopOnFailure,
  loadDataRows,
  clearData,
  runCollection,
  exportReport,
} from './runner';

// History.
export { addHistory, openHistoryEntry, clearHistory, removeHistoryEntry } from './history';

// Runtime request console (kept separate from persisted History).
export {
  appConsoleEntries,
  addAppConsoleEntry,
  clearAppConsole,
  type AppConsoleEntry,
} from './console';

// OpenAPI / Swagger import & export.
export { importOpenApiFile, importOpenApiText, exportOpenApiFolder } from './openapi';
