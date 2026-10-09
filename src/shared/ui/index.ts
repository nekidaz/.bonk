// Public API of shared/ui (like the exported names of a Go package).
// Code outside src/shared/ui/ imports only from here; files inside use relative paths.

export {
  type AppMenuKind,
  type AppMenuState,
  appMenuWidth,
  mcpConnected,
  recentWorkspaceChoices,
  snapPanelSize,
  type UtilityMode,
  workspaceInitials,
  workspaceName,
} from './appShell';
export { confirmState, requestChoice, requestConfirm } from './confirm';
export { expandTarget, oneLinePreview, toggleFocus } from './focusMode';
export { focusMode } from './focusModeStore';
export { nextTabIndex, tablist } from './tablist';
