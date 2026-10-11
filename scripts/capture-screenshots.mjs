// Capture the current application UI with synthetic, local-only API responses.
// Run npm run build first, then node scripts/capture-screenshots.mjs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { demoFixture } from './demo-fixture.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'docs/landing/screenshots');
await mkdir(out, { recursive: true });
// --demo: the landing's "02 / Demo" screens (screenshots/demo-*.jpg) from the live demo's fixture.
const demo = process.argv.includes('--demo');
const fixture = await demoFixture({ demo });

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(dist + sep)) {
      res.writeHead(403).end();
      return;
    }
    let content = await readFile(path);
    if (path.endsWith('/index.html'))
      // A function replacer: the fixture contains `$'`-style sequences that string replacement would expand.
      content = content.toString().replace('<head>', () => '<head><script>' + fixture + '</script>');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BONK_BROWSER_CHANNEL || 'chromium',
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Every request is handled by the fixture; the browser cannot call real APIs.
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === url ? route.continue() : route.abort(),
  );
  async function open(query = '') {
    await page.goto(url + query);
    await page.getByRole('tab', { name: /List payments/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    await page.mouse.move(1430, 880);
    await page.screenshot({
      path: resolve(out, `${name}.jpg`),
      type: 'jpeg',
      quality: 94,
      animations: 'disabled',
    });
    console.log(`Captured ${name}.jpg`);
  }
  if (demo) await captureDemo();
  else await captureSite();
  if (errors.length) throw new Error(errors.join('\n'));

  async function captureDemo() {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const view of ['git', 'scripts', 'tests', 'console', 'grpc', 'mcp']) {
      await page.goto(`${url}?view=${view}${view === 'git' ? '&git=1' : view === 'grpc' ? '&grpc=streams' : ''}`);
      await page.waitForSelector(`html[data-demo-ready="${view}"]`);
      await page.waitForTimeout(400);
      await shot(`demo-${view}`);
    }
  }

  async function captureSite() {
    await open();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('200 OK', { exact: false }).first().waitFor();
    await shot('hero');
    await shot('http');
    await page.locator('#bs-rtab-scripts').click();
    await shot('scripts');
    await page.getByRole('tab', { name: /Environments/ }).click();
    await shot('environments');
    await open('?grpcshot=1');
    await page.getByRole('tab', { name: /SayHello/ }).click();
    await page.locator('button.bs-send').click();
    await page.getByText('Hello, Aru', { exact: false }).first().waitFor();
    await shot('grpc');
    await open('?runner=1');
    await page.getByRole('button', { name: /Runner/ }).click();
    await page.locator('.rp-item').filter({ hasText: 'Payments API' }).click();
    await page.locator('.rn-btn.primary').click();
    await page.getByRole('button', { name: /Run all/ }).waitFor();
    await page.getByRole('button', { name: 'Export report' }).waitFor();
    // Keep inspection opt-in for maintenance as the application's UI evolves.
    if (process.argv.includes('--inspect')) console.log(await page.locator('body').innerText());
    await shot('runner');
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
