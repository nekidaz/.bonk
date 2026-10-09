/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  vitePlugin: {
    // Dev only: hold ⌃⌥ (Ctrl+Option) and click any element to open the component
    // that renders it in your editor. ⌘⇧ is taken by app hotkeys.
    inspector: { toggleKeyCombo: 'control-alt', holdMode: true, showToggleButton: 'never' },
  },
}
