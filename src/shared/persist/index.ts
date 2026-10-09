// Public API of shared/persist (like the exported names of a Go package).
// Code outside src/shared/persist/ imports only from here; files inside use relative paths.

export { flushPendingSaves, isArrayOf, loadState, persisted, saveState, saveStateDebounced } from './persist';
