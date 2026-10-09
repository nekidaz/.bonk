// Public components of features/git (like the exported names of a Go package).
// Code outside src/features/git/ imports only from here; files inside use relative paths.

export { default as GitDiffView } from './GitDiffView.svelte';
export { default as ProjectDiffView } from './ProjectDiffView.svelte';
