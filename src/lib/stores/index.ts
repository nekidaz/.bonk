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
  confirmState,
  requestConfirm,
  updateActiveTab,
  updateTabById,
} from './state';

// Persistence / hydration.
export { hydrate } from './persistence';

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
} from './requests';

// Tab lifecycle.
export { renameActiveTab, resetActiveTabTitle, newTab, setActiveProtocol, closeTab } from './tabs';

// Git diff tabs.
export { openGitDiffTab, openProjectDiffTab } from './git';

// History.
export { addHistory, openHistoryEntry, clearHistory, removeHistoryEntry } from './history';
