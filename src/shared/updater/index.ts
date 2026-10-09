// Public API of shared/updater (like the exported names of a Go package).
// Code outside src/shared/updater/ imports only from here; files inside use relative paths.

export {
  checkForUpdate,
  installUpdate,
  openReleaseNotes,
  updateCurrent,
  updateNotes,
  updateProgress,
  updateStatus,
  updateToast,
  updateVersion,
} from './updater';
