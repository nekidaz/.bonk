// Public API of entities/git (like the exported names of a Go package).
// Code outside src/entities/git/ imports only from here; files inside use relative paths.

export { openGitDiffTab, openProjectDiffTab } from './diffTabs';
export {
  checkoutBranch,
  commitChanges,
  createBranch,
  discardPaths,
  GIT_ENABLED,
  gitBusy,
  gitPrefix,
  gitStatus,
  gitStatusMap,
  gitStatusVersion,
  initRepo,
  pull,
  push,
  refreshGit,
  stagePaths,
  unstagePaths,
} from './git';
export { folderChangeCount, statusColor } from './gitStatus';
