// Visual regression suite: `make visual-baseline` (before a change), `make visual` (after).
import { defineConfig } from '@playwright/test';

// BONK_VISUAL_PORT lets two worktrees run the suite at once.
const PORT = process.env.BONK_VISUAL_PORT || '1430';

export default defineConfig({
  testDir: 'visual',
  snapshotPathTemplate: 'visual/__screenshots__/{arg}{ext}',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'visual/report', open: 'never' }]],
  fullyParallel: true,
  // Keep browser concurrency bounded, including computed-style checks.
  workers: 2,
  retries: 0,
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Strict on purpose: a 1px border or a colour step must fail. threshold 0.01 only forgives the
      // ~1-2/255 raster noise Chromium puts on shadows/blurs between runs; any real change is far above it.
      maxDiffPixels: 0,
      threshold: 0.01,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC', // timestamps are rendered in local time
    // Escape hatch when the Playwright-pinned chromium isn't downloaded: BONK_CHROMIUM=/path/to/chrome
    launchOptions: { executablePath: process.env.BONK_CHROMIUM || undefined },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node design/tools/snap-server.mjs dist ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
});
