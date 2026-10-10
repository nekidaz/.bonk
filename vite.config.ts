import { defineConfig, configDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const host = process.env.TAURI_DEV_HOST;
const test = !!process.env.VITEST;

export default defineConfig({
  // Tests run in node, which compiles `.svelte.ts` state for the server, where $effect never runs.
  // Under vitest compile it for the client and load Svelte's client runtime (`browser` condition).
  plugins: [svelte(test ? { dynamicCompileOptions: () => ({ generate: 'client' }) } : {})],
  // Layer aliases: `$shared/ipc`, `$entities/tab`, `$features/http/components` (docs/GUIDE.md «Слои фронта»).
  resolve: {
    ...(test && { conditions: ['browser'] }),
    alias: {
      $shared: fileURLToPath(new URL('./src/shared', import.meta.url)),
      $entities: fileURLToPath(new URL('./src/entities', import.meta.url)),
      $features: fileURLToPath(new URL('./src/features', import.meta.url)),
    },
  },
  // The app version, shown e.g. in the auto User-Agent header (S12).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // visual/ holds Playwright specs (`make visual`); vitest must not try to run them.
  test: { exclude: [...configDefaults.exclude, 'visual/**'] },
  // Desktop app: the bundle is read from local disk, so one big chunk costs no network time.
  // The limit only keeps the warning meaningful (it fires again past 2 MB).
  build: { chunkSizeWarningLimit: 2000 },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
