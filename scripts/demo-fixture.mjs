// The fake Tauri backend (design/tools/shim.js) as a classic <script> for public use: the landing's
// live demo (scripts/build-demo.mjs) and its screenshots (scripts/capture-screenshots.mjs).
// It renames the private fixture data, switches the UI to English and, for the demo, adds
// ?view=git|scripts|tests|console|grpc|mcp — opens that screen after the app mounts.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { version } = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'));

const root = resolve(import.meta.dirname, '..');

// The fixture's Russian sample data, in English. Longer strings first ("Тимур К." before "Тимур").
const TRANSLATE = [
  ['Сколько записей вернуть', 'Number of payments to return'],
  ['Начало периода', 'Period start'],
  ['Конец периода', 'Period end'],
  ['Формат ответа', 'Response format'],
  ['Новый на каждый запрос', 'Unique for each request'],
  ['Для логов сервера', 'Client identifier'],
  ['Имя для приветствия', 'Name to greet'],
  ['Язык ответа, напр. "ru"', 'Reply language, e.g. "en"'],
  ['Список меток', 'Tags'],
  ['Айгерим Касымова', 'Maya Collins'],
  ['Тимур К.', 'Timur K.'],
  ['Тимур', 'Leo'],
  ['Нурланов', 'Harper'],
  ['Финансовый аналитик', 'Financial analyst'],
  ['ТОО «Алем Трейд»', 'Northwind Trading'],
  ['г-жа', 'Ms.'],
  ['Алматы', 'Lisbon'],
  ['не найден', 'not found'],
  [
    'не совпадает с адресом, зарегистрированным у приложения bonk-dev.',
    'does not match the address registered for the bonk-dev app.',
  ],
  ['получен', 'received'],
  ['Дилмурат З.', 'Dana K.'],
  ['Ару С.', 'Aru S.'],
  [
    'в Create refund и Issue token — повторная отправка не создаёт второй возврат.',
    'on Create refund and Issue token — a retried request no longer creates a second refund.',
  ],
  // Flow · Scenario with input and Flow · Session (the shim's «ask on send» fields and sandbox session).
  ['Код из SMS', 'SMS code'],
  ['отправлен на', 'sent to'],
  ['Подтвердить списание?', 'Confirm the charge?'],
  ['Сумма', 'Amount'],
  ['Валюта', 'Currency'],
  ['Комментарий', 'Comment'],
  ['Почта получателя', 'Recipient email'],
  ['CVC карты', 'Card CVC'],
  ['Позиции заказа', 'Order items'],
  ['Счёт', 'Invoice'],
  ['Регион', 'Region'],
  ['Астана', 'Porto'],
  ['Шымкент', 'Faro'],
  ['Караганда', 'Braga'],
  ['Актау', 'Aveiro'],
  ['(тест)', '(test)'],
];

const DEMO_SCRIPT = `// ── Helpers ─────────────────────────────
const data = pm.response.json();
const isDate = (s) => !Number.isNaN(Date.parse(s));
function assertMoney(v) {
  pm.expect(v).to.be.a('number');
  pm.expect(v).to.be.above(0);
}

// ── Response contract ───────────────────
pm.test('Status is 200', function () {
  pm.expect(pm.response).to.have.status(200);
});
pm.test('List schema', function () {
  pm.expect(data).to.have.keys('items', 'next', 'total');
  pm.expect(data.items).to.be.an('array');
});
pm.test('Every payment is valid', function () {
  data.items.forEach((p, i) => {
    pm.expect(p.id, \`items[\${i}].id\`).to.match(/^pay_/);
    assertMoney(p.amount);
    pm.expect(isDate(p.created_at)).to.be.true;
  });
});
pm.test('Pagination', function () {
  pm.expect(data.items.length).to.be.at.most(20);
});

// ── Environment ─────────────────────────
pm.environment.set('payment_id', data.items[0].id);
pm.environment.set('next_cursor', data.next ?? '');
if (data.total > 1000) {
  console.log('large page', data.total);
}`;

// Runs in the page (stringified into the fixture). Waits for the app, then clicks to the screen
// named by ?view= — the same steps a person would take, so it breaks loudly if the UI changes.
function demoChrome() {
  const view = new URLSearchParams(location.search).get('view');
  const until = (find, ms = 5000) =>
    new Promise((done, fail) => {
      const t0 = Date.now();
      const tick = () => {
        const el = find();
        if (el) return done(el);
        if (Date.now() - t0 > ms) return fail(new Error(`demo: ${view} step timed out`));
        setTimeout(tick, 50);
      };
      tick();
    });
  const byText = (sel, text) => () =>
    [...document.querySelectorAll(sel)].find((el) =>
      text instanceof RegExp ? text.test(el.textContent.trim()) : el.textContent.trim() === text,
    );
  const byLabel = (label) => () => document.querySelector(`[aria-label="${label}"], [title="${label}"]`);
  const click = async (find) => (await until(find)).click();
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const STEPS = {
    git: async () => {
      await click(byLabel('Source control'));
      await click(byText('button', /^Graph/));
    },
    scripts: async () => {
      await click(() => document.querySelector('#bs-rtab-scripts'));
      await click(byText('button, [role="tab"]', /Post-response/));
      await click(byLabel('Close snippets'));
      await click(() => document.querySelector('[aria-label="Expand"], [title="Expand"]'));
    },
    tests: async () => {
      await click(() => document.querySelector('button.bs-send'));
      await click(byText('[role="tab"]', /^Tests/));
    },
    console: async () => {
      await click(() => document.querySelector('button.bs-send'));
      await pause(400);
      await click(byText('[role="tab"]', /SayHello/));
      await click(() => document.querySelector('button.bs-send'));
      await pause(400);
      await click(byText('[role="tab"]', /List payments/));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', metaKey: true, bubbles: true }));
    },
    grpc: async () => {
      const leaf = (text) => () =>
        [...document.querySelectorAll('.bs-sidebar-content *')].find(
          (el) => !el.children.length && el.textContent.trim() === text,
        );
      await click(leaf('Greeter (gRPC)'));
      await click(leaf('CollectNames'));
      await click(() => document.querySelector('button.bs-send'));
    },
    mcp: async () => {
      await click(byLabel('Settings'));
      await click(byText('button, [role="tab"], a', /AI \/ MCP$/));
    },
  };
  addEventListener('DOMContentLoaded', async () => {
    // No macOS title bar in a browser: keep the app's inset for it and draw the traffic lights.
    document.documentElement.dataset.nativeMacos = 'true';
    const lights = document.createElement('div');
    lights.style.cssText = 'position:fixed;top:15px;left:16px;display:flex;gap:8px;z-index:9999;pointer-events:none';
    for (const c of ['#ff5f57', '#febc2e', '#28c840']) {
      const dot = document.createElement('span');
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c}`;
      lights.append(dot);
    }
    document.body.append(lights);
    await until(byText('[role="tab"]', /List payments/), 10000);
    await document.fonts.ready;
    await STEPS[view]?.();
    document.documentElement.dataset.demoReady = view ?? 'home';
  });
}

/** @param {{ demo?: boolean }} opts demo: Dummy Payments on Production with the ?view= driver. */
export async function demoFixture({ demo = false } = {}) {
  const name = demo ? 'Dummy Payments' : 'Orbit Payments';
  const host = demo ? 'dummypay.dev' : 'orbit.example';
  let fixture = (await readFile(resolve(root, 'design/tools/shim.js'), 'utf8'))
    .replace('export const ready = true;', '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replaceAll('Acme Payments', name)
    .replaceAll('Acme Business', name)
    .replaceAll('acme-payments', 'dummy-payments')
    .replaceAll('github.com:acme/', 'github.com:dummypay/')
    .replaceAll('Sandbox Gateway', 'Local development')
    .replaceAll('acmepay.example', host)
    .replaceAll('sk_live_51HcQe9xK2mP7vR3t4f2a', 'demo-token-not-a-credential')
    .replaceAll('sk_test_9f3a', 'demo-staging-token')
    .replace("'plugin:app|version': () => '0.1.8'", `'plugin:app|version': () => '${version}'`)
    .replace('const STATE = {', "const STATE = { uiLanguage: 'en', requestLayout: 'side',")
    .replace(
      "activeEnvironmentId: Q.get('empty') ? null : 'env-prod'",
      `activeEnvironmentId: Q.get('empty') ? null : '${demo ? 'env-prod' : 'env-staging'}'`,
    )
    .replace(
      'window.__TAURI_INTERNALS__ = {',
      `
STATE.tabs[0].request.testScript = ${JSON.stringify(
        demo
          ? DEMO_SCRIPT
          : 'pm.test("Status is 200", () => {\n  pm.expect(pm.response).to.have.status(200);\n});\n\npm.test("Payment is captured", () => {\n  const payment = pm.response.json();\n  pm.expect(payment.status).to.eql("captured");\n});',
      )};
STATE.tabs.push({ id: 'tab-grpc', protocol: 'grpc', title: 'SayHello', manualTitle: true,
  savedPath: 'fs:greeter/hello', request: req('POST', ''), grpc: GRPC('SayHello') });
if (Q.has('grpcshot')) STATE.activeTabId = 'tab-grpc';
${
  demo
    ? `H.run_script = () => JSON.stringify({
  logs: [{ level: 'log', args: ['payments', 20] }, { level: 'log', args: ['next cursor', 'cur_9Qx2'] }],
  tests: [
    { name: 'Status is 200', passed: true },
    { name: 'List schema', passed: true },
    { name: 'Every payment is valid', passed: false, error: 'AssertionError: expected "2026-13-01" to be a valid date (items[7].created_at)' },
    { name: 'Pagination', passed: true },
  ],
  vars: { payment_id: 'pay_8f2k1' }, error: null,
});
(${demoChrome})();`
    : ''
}
window.__TAURI_INTERNALS__ = {`,
    );
  for (const [ru, en] of TRANSLATE) fixture = fixture.replaceAll(ru, en);
  // The fixture is published: fail instead of shipping a private name or untranslated data.
  const leak = fixture.match(/acme|[А-Яа-яЁё]+/i);
  if (leak) throw new Error(`demo fixture still contains "${leak[0]}" — add a replacement in scripts/demo-fixture.mjs`);
  return fixture;
}
