// Build the landing's live demo: the real frontend on the fake backend, in docs/landing/demo/.
// Run node scripts/build-demo.mjs after UI changes (and before a release) so the demo matches the app.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { demoFixture } from './demo-fixture.mjs';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/landing/demo');
const build = await mkdtemp(join(tmpdir(), 'bonk-demo-'));

try {
  // Relative asset paths: the demo lives under /.bonk/demo/ on GitHub Pages.
  execFileSync('npx', ['vite', 'build', '--base', './', '--outDir', build, '--emptyOutDir'], {
    cwd: root,
    stdio: 'inherit',
  });
  await rm(out, { recursive: true, force: true });
  await cp(build, out, {
    recursive: true,
    // Browsers that run the app all take woff2; the .woff fallbacks would only bloat the repo.
    filter: (path) => !path.endsWith('.woff'),
  });
  await writeFile(join(out, 'fixture.js'), await demoFixture({ demo: true }));
  const index = join(out, 'index.html');
  // The fixture must run before the app's module script (it installs window.__TAURI_INTERNALS__).
  const html = (await readFile(index, 'utf8')).replace(
    '<meta charset="UTF-8" />',
    (charset) => `${charset}\n    <meta name="robots" content="noindex" />\n    <script src="fixture.js"></script>`,
  );
  if (!html.includes('fixture.js')) throw new Error('demo: index.html has no <meta charset> to anchor the fixture');
  await writeFile(index, html);
  const files = await readdir(join(out, 'assets'));
  console.log(`demo: ${files.length} assets → ${out}`);
} finally {
  await rm(build, { recursive: true, force: true });
}
