import { mount } from 'svelte';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
// Fonts are vendored (not CDN) so this local-first app renders fully offline
// and never phones home on launch. Inter = UI; JetBrains Mono = code/labels; Material
// Symbols Outlined = UI icons (its `.material-symbols-outlined` utility class
// lives in app.css; this import only provides the @font-face). Weight 300
// is the Bonk Mono icon weight (no font-variation/FILL is used).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/material-symbols-outlined/300.css';
import './app.css';
import './bigsur.css';
import { applyStoredTheme } from '$shared/settings';
import { watchDocumentLang } from '$shared/i18n';
import App from './app/App.svelte';

// Native macOS title bars overlay their traffic lights on our toolbar — except in full screen, where macOS hides them.
const nativeMacos = isTauri() && /Mac/i.test(navigator.platform);
document.documentElement.dataset.nativeMacos = String(nativeMacos);
if (nativeMacos) {
  const win = getCurrentWindow();
  const sync = async () => {
    document.documentElement.dataset.nativeMacos = String(!(await win.isFullscreen()));
  };
  void sync();
  void win.onResized(sync);
}

// Apply the persisted theme before mount to avoid a flash.
applyStoredTheme();
// Background watchers (like goroutines started in main): they live as long as the window.
watchDocumentLang();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
