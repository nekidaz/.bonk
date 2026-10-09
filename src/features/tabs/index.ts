// Public API of features/tabs (like the exported names of a Go package).
// Code outside src/features/tabs/ imports only from here; files inside use relative paths.

export {
  closeAllTabs,
  closeOtherTabs,
  closeTabsToRight,
  duplicateTab,
  moveTab,
  newTab,
  renameActiveTab,
  reopenClosedTab,
  requestCloseTab,
  resetActiveTabTitle,
  setActiveProtocol,
  togglePinTab,
} from './store';
