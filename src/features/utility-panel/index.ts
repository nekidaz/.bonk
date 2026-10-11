// Public API of features/utility-panel (like the exported names of a Go package).
// Code outside src/features/utility-panel/ imports only from here; files inside use relative paths.

export { utilityUi } from './store.svelte';
export { groupIssues, type IssueGroup } from './issues';
