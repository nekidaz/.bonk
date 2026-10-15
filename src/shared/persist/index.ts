// Public API of shared/persist (like the exported names of a Go package).
// Code outside src/shared/persist/ imports only from here; files inside use relative paths.

export { flushPendingSaves, isArrayOf, loadState, saveState, saveStateDebounced } from './persist';
export { persisted, type Persisted } from './persisted.svelte';
export { setting, type Setting, settingsFile, settingSpecs, type SettingSpec } from './settings.svelte';
