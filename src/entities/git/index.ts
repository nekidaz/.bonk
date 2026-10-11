// Public API of entities/git (like the exported names of a Go package).
// Code outside src/entities/git/ imports only from here; files inside use relative paths.

export { openCommitEditorTab, openGitDiffTab, openProjectDiffTab, openStashTab } from './diffTabs';
export {
  commitChanges,
  createBranch,
  discardPaths,
  git,
  GIT_ENABLED,
  initRepo,
  pull,
  push,
  refreshGit,
  requestCheckout,
  stagePaths,
  stashApply,
  stashBranch,
  stashDrop,
  stashPop,
  stashPush,
  switchBranch,
  unstagePaths,
  watchGitWorkspace,
  type PendingSwitch,
  type StashOptions,
  type SwitchChoice,
} from './git.svelte';
export { MESSAGE_MAX_LINES, messageParts, SUBJECT_MAX } from './commitMessage';
export {
  describeFile,
  folderChangeCount,
  relativeAgo,
  shortAgo,
  statusColor,
  statusLetter,
  type FileInfo,
} from './gitStatus';
