// Public components of shared/editor (like the exported names of a Go package).
// Code outside src/shared/editor/ imports only from here; files inside use relative paths.

export { default as CodeEditor, type CodeEditorLang } from './CodeEditor.svelte';
export { default as EditorTools } from './EditorTools.svelte';
export { default as ScriptsEditor } from './ScriptsEditor.svelte';
