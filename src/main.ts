import { mount } from 'svelte'
// Fonts are vendored (not CDN) so this local-first app renders fully offline
// and never phones home on launch. JetBrains Mono = code/labels; Material
// Symbols Outlined = UI icons (its `.material-symbols-outlined` utility class
// lives in app.css; this import only provides the @font-face). Weight 400
// matches the default the UI renders at (no font-variation/FILL is used).
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/material-symbols-outlined/400.css'
import './app.css'
import './bigsur.css'
import { applyStoredTheme } from './lib/theme'
import App from './App.svelte'

// Apply the persisted theme (light/dark) before mount to avoid a flash.
applyStoredTheme()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
