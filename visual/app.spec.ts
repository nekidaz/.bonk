// Visual regression: every scenario x both themes against the fake Tauri backend
// (design/tools/shim.js). Baselines are local only; see docs/GUIDE.md "Скриншот-тесты".
import { test, expect, type Page } from '@playwright/test';
import { dumpComputedStyles } from './css-oracle';

// CSS_ORACLE=<dir>: dump computed styles (css-oracle.ts) instead of taking screenshots.
const ORACLE = process.env.CSS_ORACLE;

const THEMES = ['smooth-light', 'smooth-dark'] as const;
// Fixed "now": relative timestamps ("2 min ago") and history grouping stay identical on every run.
const NOW = new Date('2026-10-08T14:05:00Z');

type Scenario = {
  name: string;
  query?: string; // shim scenario, e.g. '&http=401'
  steps?: (page: Page) => Promise<void>;
  // Elements that are genuinely live (timers); everything else must be deterministic.
  mask?: (page: Page) => ReturnType<Page['locator']>[];
  hover?: boolean; // keep the mouse where the steps left it (hover states) instead of parking it in a corner
  viewport?: { width: number; height: number };
};

// --- small helpers -------------------------------------------------------------------------
const send = async (p: Page) => {
  await p.locator('button.bs-send').click();
  await p
    .locator('.bs-send[aria-busy="true"]')
    .waitFor({ timeout: 2000 })
    .catch(() => {});
  await p.waitForFunction(() => !document.querySelector('.bs-send[aria-busy="true"]'));
};
const row = (p: Page, text: string) => p.locator('.bs-trow').filter({ hasText: text }).first();
// Opening a request in the sidebar needs a double click (pointer-event drag and drop); a folder opens on one.
const openRequest = (p: Page, name: string) => row(p, name).dblclick();
const openGrpc = async (p: Page) => {
  await row(p, 'Greeter').click();
  await openRequest(p, 'SayHello');
  await p.locator('.bs-grpc-trigger').waitFor();
};
const rtab = (p: Page, id: string) => p.locator(`#bs-rtab-${id}`).click();
const resptab = (p: Page, id: string) => p.locator(`#bs-resptab-${id}`).click();
const key = (p: Page, k: string) => p.keyboard.press(k);
const settings = async (p: Page, index: number) => {
  await key(p, 'ControlOrMeta+Comma');
  await p.locator('.st-sheet').waitFor();
  await p.locator('.st-item').nth(index).click();
};

const SCENARIOS: Scenario[] = [
  // HTTP request editor tabs
  { name: 'http-params' },
  { name: 'http-auth', steps: (p) => rtab(p, 'auth') },
  { name: 'http-headers', steps: (p) => rtab(p, 'headers') },
  { name: 'http-body-none', steps: (p) => rtab(p, 'body') },
  { name: 'http-scripts', steps: (p) => rtab(p, 'scripts') },
  {
    name: 'http-post-body',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await rtab(p, 'body');
    },
  },
  {
    name: 'http-post-auth',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await rtab(p, 'auth');
    },
  },
  { name: 'http-long-url', query: '&long=1' },
  { name: 'http-method-menu', steps: (p) => p.locator('.bs-method').click() },
  { name: 'http-code-snippet', steps: (p) => p.locator('button.bs-hb').click() },
  // HTTP response
  { name: 'resp-body', steps: send },
  {
    name: 'resp-raw',
    steps: async (p) => {
      await send(p);
      await p.getByRole('radio', { name: 'Raw', exact: true }).click();
    },
  },
  {
    name: 'resp-headers',
    steps: async (p) => {
      await send(p);
      await resptab(p, 'headers');
    },
  },
  {
    name: 'resp-cookies',
    steps: async (p) => {
      await send(p);
      await resptab(p, 'cookies');
    },
  },
  {
    name: 'resp-timeline',
    steps: async (p) => {
      await send(p);
      await resptab(p, 'timeline');
    },
  },
  { name: 'resp-401', query: '&http=401', steps: send },
  { name: 'resp-500', query: '&http=500', steps: send },
  { name: 'resp-timeout', query: '&http=timeout', steps: send },
  {
    name: 'prod-guard',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await p.locator('button.bs-send').click();
      await p.locator('.bs-guard').waitFor();
    },
  },
  {
    name: 'prod-guard-confirmed',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await p.locator('button.bs-send').click();
      await p.locator('.bs-guard-input').fill('Production');
    },
  },
  {
    name: 'resp-post-created',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await p.locator('button.bs-send').click();
      await p.locator('.bs-guard-input').fill('Production');
      await p.locator('.bs-guard-send').click();
      await p.locator('.bs-guard').waitFor({ state: 'detached' });
      await p.waitForFunction(() => !document.querySelector('.bs-send[aria-busy="true"]'));
    },
  },
  // gRPC
  { name: 'grpc-idle', steps: openGrpc },
  {
    name: 'grpc-method-picker',
    steps: async (p) => {
      await openGrpc(p);
      await p.locator('.bs-grpc-trigger').click();
    },
  },
  {
    name: 'grpc-tls-popover',
    steps: async (p) => {
      await openGrpc(p);
      await p.locator('.bs-grpc-security').click();
    },
  },
  {
    name: 'grpc-invoke-ok',
    steps: async (p) => {
      await openGrpc(p);
      await send(p);
    },
  },
  {
    name: 'grpc-invalid',
    query: '&grpc=invalid',
    steps: async (p) => {
      await openGrpc(p);
      await send(p);
    },
  },
  {
    name: 'grpc-down',
    query: '&grpc=down',
    steps: async (p) => {
      await openGrpc(p);
      await send(p);
      await p.getByText('UNAVAILABLE').first().waitFor();
    },
  },
  {
    name: 'grpc-metadata',
    steps: async (p) => {
      await openGrpc(p);
      await p.getByRole('tab', { name: /Metadata/ }).click();
    },
  },
  {
    name: 'grpc-auth',
    steps: async (p) => {
      await openGrpc(p);
      await p.getByRole('tab', { name: 'Auth' }).click();
    },
  },
  {
    name: 'grpc-proto',
    steps: async (p) => {
      await openGrpc(p);
      await p.getByRole('tab', { name: 'Proto' }).click();
    },
  },
  {
    name: 'grpc-stream-live',
    query: '&grpc=stream',
    steps: async (p) => {
      await row(p, 'Greeter').click();
      await openRequest(p, 'SayHelloStream');
      await p.locator('.bs-grpc-trigger').waitFor();
      await p.locator('button.bs-send').click();
      await p.getByText('#2', { exact: true }).waitFor(); // messages tick once a second; #3 is a full second away
    },
  },
  {
    name: 'grpc-stream-error',
    query: '&grpc=streamerr',
    steps: async (p) => {
      await row(p, 'Greeter').click();
      await openRequest(p, 'SayHelloStream');
      await p.locator('.bs-grpc-trigger').waitFor();
      await p.locator('button.bs-send').click();
      await p.getByText('INTERNAL').first().waitFor();
    },
  },
  // sidebar
  {
    name: 'sidebar-all-expanded',
    steps: async (p) => {
      await row(p, 'Greeter').click();
      await row(p, 'Webhooks').click();
    },
  },
  { name: 'sidebar-history', steps: (p) => p.getByRole('button', { name: 'History' }).click() },
  { name: 'sidebar-filter', steps: (p) => p.locator('.bs-fbox-input').fill('token') },
  { name: 'sidebar-filter-empty', steps: (p) => p.locator('.bs-fbox-input').fill('zzzz') },
  { name: 'sidebar-request-menu', steps: (p) => row(p, 'Get payment').click({ button: 'right' }) },
  { name: 'sidebar-folder-menu', steps: (p) => row(p, 'Payments API').click({ button: 'right' }) },
  { name: 'sidebar-create-menu', steps: (p) => p.locator('button.bs-fi').click() },
  {
    name: 'sidebar-import-menu',
    steps: async (p) => {
      await p.locator('button.bs-fi').click();
      await p.locator('.bs-menu .mi').filter({ hasText: 'Импорт' }).click();
    },
  },
  {
    name: 'sidebar-history-menu',
    steps: async (p) => {
      await p.getByRole('button', { name: 'History' }).click();
      await p.locator('.bs-history-options').first().click();
    },
  },
  { name: 'sidebar-folder-menu-full', steps: (p) => row(p, 'Auth').click({ button: 'right' }) },
  {
    name: 'sidebar-move-submenu',
    steps: async (p) => {
      await row(p, 'Get payment').click({ button: 'right' });
      await p.locator('.bs-menu .mi').filter({ hasText: 'Переместить' }).click();
    },
  },
  {
    name: 'sidebar-rename-inline',
    steps: async (p) => {
      await row(p, 'Get payment').click({ button: 'right' });
      await p.locator('.bs-menu .mi').filter({ hasText: 'Переименовать' }).click();
    },
  },
  {
    name: 'folder-auth-dialog',
    steps: async (p) => {
      await row(p, 'Payments API').click({ button: 'right' });
      await p.locator('.bs-menu .mi').filter({ hasText: 'Авторизация коллекции' }).click();
    },
  },
  {
    name: 'delete-confirm',
    steps: async (p) => {
      await row(p, 'Get payment').click({ button: 'right' });
      await p.locator('.bs-menu .mi.danger').click();
    },
  },
  // hover / focus states
  { name: 'hover-sidebar-row', hover: true, steps: (p) => row(p, 'Refund payment').hover() },
  { name: 'hover-send', hover: true, steps: (p) => p.locator('button.bs-send').hover() },
  { name: 'hover-tab', hover: true, steps: (p) => p.getByRole('tab', { name: /Create payment/ }).hover() },
  {
    name: 'focus-keyboard',
    steps: async (p) => {
      await p.locator('button.bs-send').focus();
      await key(p, 'Shift+Tab');
      await key(p, 'Shift+Tab');
    },
  },
  // layouts, language, window size
  { name: 'layout-side', query: '&layout=side', steps: (p) => send(p) },
  { name: 'layout-focus', query: '&layout=focus', steps: (p) => send(p) },
  { name: 'lang-en', query: '&lang=en' },
  { name: 'lang-en-settings', query: '&lang=en', steps: (p) => settings(p, 2) },
  { name: 'small-window-http', viewport: { width: 1024, height: 640 } },
  {
    name: 'small-window-grpc',
    viewport: { width: 1024, height: 640 },
    steps: async (p) => {
      await openGrpc(p);
      await send(p);
    },
  },
  // chrome / overlays
  { name: 'palette', steps: (p) => key(p, 'ControlOrMeta+k') },
  {
    name: 'palette-query',
    steps: async (p) => {
      await key(p, 'ControlOrMeta+k');
      await p.keyboard.type('tok');
    },
  },
  { name: 'tab-context-menu', steps: (p) => p.getByRole('tab', { name: /Create payment/ }).click({ button: 'right' }) },
  { name: 'tab-new', steps: (p) => key(p, 'ControlOrMeta+t') },
  {
    name: 'save-dialog',
    steps: async (p) => {
      await key(p, 'ControlOrMeta+Shift+s');
      await p.getByRole('dialog').waitFor();
    },
  },
  { name: 'env-tab', steps: (p) => p.getByRole('tab', { name: /Environments/ }).click() },
  { name: 'env-selector', steps: (p) => p.locator('.bs-toolbar-env-button').click() },
  { name: 'workspace-menu', steps: (p) => p.locator('.bs-work').click() },
  {
    name: 'env-selector-search',
    steps: async (p) => {
      await p.locator('.bs-toolbar-env-button').click();
      await p.keyboard.type('stag');
    },
  },
  {
    name: 'save-toast',
    steps: async (p) => {
      await p.getByRole('tab', { name: /Create payment/ }).click();
      await key(p, 'ControlOrMeta+s');
      await p.locator('.bs-toast, [role=status]').first().waitFor();
    },
  },
  { name: 'console', steps: (p) => p.getByRole('button', { name: /Console/ }).click() },
  {
    name: 'console-after-send',
    steps: async (p) => {
      await p.getByRole('button', { name: /Console/ }).click();
      await send(p);
    },
  },
  { name: 'terminal', steps: (p) => p.getByRole('button', { name: /Terminal/ }).click() },
  {
    name: 'terminal-output',
    steps: async (p) => {
      await p.getByRole('button', { name: /Terminal/ }).click();
      await p.locator('input').last().fill('bonk --version');
      await key(p, 'Enter');
      await p.getByText('3 collections').waitFor();
    },
  },
  { name: 'response-search', steps: (p) => p.locator('button.bs-ric').first().click() },
  { name: 'response-collapse-all', steps: (p) => p.locator('button.bs-ric').nth(1).click() },
  { name: 'response-expanded', steps: (p) => p.locator('button.bs-ric').last().click() },
  // settings (one shot per section)
  ...['general', 'requests', 'proxy', 'certs', 'grpc', 'mcp', 'appearance', 'hotkeys', 'data'].map(
    (id, i): Scenario => ({ name: `settings-${id}`, steps: (p) => settings(p, i) }),
  ),
  // runner
  {
    name: 'runner-setup',
    query: '&runner=1',
    steps: async (p) => {
      await p.getByRole('button', { name: /Runner/ }).click();
      await p.locator('.rp-item').filter({ hasText: 'Payments API' }).click();
    },
  },
  {
    name: 'runner-results',
    query: '&runner=1',
    mask: (p) => [p.locator('.rn-wf')], // bar offsets come from real wall-clock timing, +-1px between runs
    steps: async (p) => {
      await p.getByRole('button', { name: /Runner/ }).click();
      await p.locator('.rp-item').filter({ hasText: 'Payments API' }).click();
      await p.locator('.rn-btn.primary').click();
      await p.locator('.rn-cell.bad').first().waitFor();
      await p.locator('.rn-cell.bad.on').waitFor(); // the failed cell opens the detail pane by itself
    },
  },
  // empty states
  { name: 'welcome-empty', query: '&empty=1' },
  { name: 'welcome-notabs', query: '&notabs=1' },
];

for (const theme of THEMES) {
  test.describe(theme, () => {
    for (const s of SCENARIOS) {
      test(s.name, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        // Nothing may leave the machine; the shim answers every backend call.
        await page.route('**/*', (r) =>
          new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort(),
        );
        if (s.viewport) await page.setViewportSize(s.viewport);
        await page.clock.setFixedTime(NOW);
        await page.goto(`/?theme=${theme}${s.query ?? ''}`);
        await page.locator('.bs-status').waitFor();
        await s.steps?.(page);
        await page.evaluate(() => document.fonts.ready);
        if (!s.hover) await page.mouse.move(1439, 899);
        // Let enter transitions (menus, dialogs, toasts) run to their end state. Infinite ones (spinners) are left alone.
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => {})),
          ),
        );
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        if (ORACLE) await dumpComputedStyles(page, ORACLE, `${theme}-${s.name}`);
        else await expect(page).toHaveScreenshot(`${theme}-${s.name}.png`, { mask: s.mask?.(page) });
        expect(errors).toEqual([]);
      });
    }
  });
}

// Not a screenshot: what a few interactions save to app state (the shim's state.json), so a change in
// how state is wired to disk can't silently stop saving a key.
test('saves the session to app state', async ({ page }) => {
  await page.goto('/?theme=smooth-light');
  await page.locator('.bs-status').waitFor();
  await send(page);
  await page.getByRole('tab', { name: /Create payment/ }).click();
  await openRequest(page, 'Get payment');
  await row(page, 'Auth').click(); // collapse a folder
  type Saved = {
    tabs: { id: string; savedPath?: string; testResults?: unknown }[];
    activeTabId: string;
    history: { request: { method: string }; status: number }[];
    expandedFolders: Record<string, string[]>;
    workspacePath: string;
  };
  const saved = () =>
    page.evaluate(() =>
      (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<Saved> } }
      ).__TAURI_INTERNALS__.invoke('app_state_load'),
    );
  const root = '/Users/aru/work/Acme Payments';
  await expect.poll(async () => (await saved()).expandedFolders?.[root]).toContain('fs:payments');
  await expect
    .poll(async () => (await saved()).tabs.map((t) => t.savedPath))
    .toEqual(['fs:payments/list', 'fs:payments/create', undefined, 'fs:payments/get']); // undefined: Environments tab
  const s = await saved();
  expect(s.activeTabId).toBe(s.tabs[3].id);
  expect(s.tabs.some((t) => 'testResults' in t)).toBe(false);
  expect(s.history).toHaveLength(8);
  expect([s.history[0].request.method, s.history[0].status]).toEqual(['GET', 200]);
  expect(s.expandedFolders[root]).not.toContain('fs:auth');
  expect(s.workspacePath).toBe(root);
});

// Not a screenshot: the sidebar tree renders only the rows in view, and scrolling or ↑↓ reach the rest.
test('virtual sidebar tree handles 10k requests', async ({ page }) => {
  await page.goto('/?big=1&notabs=1');
  const tree = page.locator('.bs-tree');
  await row(page, 'Service 0').waitFor();
  expect(await page.locator('.bs-tree .bs-trow').count()).toBeLessThan(100);
  // 100 folders + 10 000 requests, one pitch each.
  expect(await tree.evaluate((el) => el.scrollHeight)).toBeGreaterThan(10_100 * 25);

  await row(page, 'Service 0').focus();
  await page.keyboard.press('ArrowDown', { delay: 0 });
  for (let i = 1; i < 60; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toContainText('Request 0.59');

  await tree.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(row(page, 'Request 99.99')).toBeVisible();
  expect(await page.locator('.bs-tree .bs-trow').count()).toBeLessThan(100);

  // Switching to a tab whose request is scrolled out of the DOM scrolls the tree back to it.
  await openRequest(page, 'Request 99.99');
  await tree.evaluate((el) => (el.scrollTop = 0));
  await openRequest(page, 'Request 0.1');
  await page.getByRole('tab', { name: /Request 99\.99/ }).click();
  await expect(page.locator('.bs-trow.sel')).toContainText('Request 99.99');
  await expect(page.locator('.bs-trow.sel')).toBeInViewport();
});
