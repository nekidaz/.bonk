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
  responsePrettyDefault,
  proxyMode,
  proxyUrl,
  proxyBypass,
  trustedCaPaths,
  grpcDeadlineMs,
  grpcAutoReflect,
  collections,
  workspacePath,
  recentWorkspacePaths,
  globals,
  environments,
  activeEnvironmentId,
  environmentsSheetOpen,
  flows,
  currentVarScope,
  withInheritedAuth,
  confirmState,
  requestConfirm,
  productionGuard,
  requestProductionSend,
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
  openEnvironmentsSheet,
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
  renameWorkspaceFolder,
  deleteWorkspace,
  addFolder,
  saveFolderAuth,
  removeNode,
  renameNode,
  toggleFolder,
  revealNode,
  duplicateNode,
  moveNode,
} from './workspace';

// Request save/open/send.
export {
  currentRequestSettings,
  saveActiveRequest,
  restoreSavedRequest,
  revertActiveTab,
  setActiveRequestOverrides,
  resetActiveRequestOverrides,
  addRequestToFolder,
  openSavedRequest,
  applyCurlToActiveTab,
  sendHttpRequest,
  applyScriptVars,
} from './requests';

// Tab lifecycle.
export { renameActiveTab, resetActiveTabTitle, newTab, moveTab, setActiveProtocol, closeTab, requestCloseTab, duplicateTab, closeOtherTabs, closeAllTabs, reopenClosedTab } from './tabs';

// Git diff tabs.
export { openGitDiffTab, openProjectDiffTab } from './git';

// Collection Runner (the runner tab, config setters, orchestrator, export).
export {
  runnerConfig,
  runnerRun,
  RUNNER_ROOT,
  openRunnerTab,
  setRunnerFolders,
  runnerStage,
  setRunnerStage,
  runInRunner,
  repeatRun,
  setExcluded,
  setRunOrder,
  orderedRequests,
  plannedRequests,
  togglePause,
  stopRun,
  runnerHistory,
  loadRunnerState,
  runnerScopeTitle,
  collectRequests,
  rerunFailed,
  rerunCall,
  bindIdFrom,
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
export { importOpenApiFile, importOpenApiText, importApiFile, importApiText, exportOpenApiFolder } from './openapi';

// Saved tabs whose content differs from their file (S09).
export { dirtyTabIds } from './dirty';
export * from './prefs';
export * from './hotkeys';

// Data & import settings (self-persisting).
export { exportIncludeSecrets, historyDays } from './dataPrefs';
