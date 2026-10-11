// Public components of features/git (like the exported names of a Go package).
// Code outside src/features/git/ imports only from here; files inside use relative paths.

export { default as BranchMenu } from './BranchMenu.svelte';
export { default as CommitEditor } from './CommitEditor.svelte';
export { default as GraphView } from './GraphView.svelte';
export { default as GitDiffView } from './GitDiffView.svelte';
export { default as ProjectDiffView } from './ProjectDiffView.svelte';
export { default as StashMenu } from './StashMenu.svelte';
export { default as StashView } from './StashView.svelte';
export { default as SwitchDialog } from './SwitchDialog.svelte';
