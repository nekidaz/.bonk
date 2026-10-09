// Public API of entities/history (like the exported names of a Go package).
// Code outside src/entities/history/ imports only from here; files inside use relative paths.

export { exportFormat, exportIncludeSecrets, historyDays, watchHistoryRetention } from './dataPrefs.svelte';
export { addHistory, clearHistory, history, openHistoryEntry, removeHistoryEntry } from './store.svelte';
