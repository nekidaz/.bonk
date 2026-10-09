import { defineConfig, configDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  // The app version, shown e.g. in the auto User-Agent header (S12).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // visual/ holds Playwright specs (`make visual`); vitest must not try to run them.
  test: { exclude: [...configDefaults.exclude, 'visual/**'] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
