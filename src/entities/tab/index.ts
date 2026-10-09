// Public API of entities/tab (like the exported names of a Go package).
// Code outside src/entities/tab/ imports only from here; files inside use relative paths.

export { activeTabId, tabs, updateActiveTab, updateTabById } from './store';
export {
  GRPC_DEFAULT_TITLE,
  grpcSnapshot,
  HTTP_DEFAULT_TITLE,
  moveTabTo,
  newGrpcTab,
  newHttpTab,
  normalizeTabTitleState,
  relinkTabPaths,
  stripRuntimeTab,
  switchedProtocol,
  tabsToClose,
  titleFromUrl,
  togglePinned,
} from './tab';
