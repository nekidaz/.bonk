// Public components of features/command-palette (like the exported names of a Go package).
// Code outside src/features/command-palette/ imports only from here; files inside use relative paths.

export { default as CommandPalette, type PaletteCommand } from './CommandPalette.svelte';
