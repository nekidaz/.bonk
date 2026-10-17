// Computed-style oracle: `make css-oracle-baseline` / `make css-oracle`.
// Instead of a screenshot, app.spec.ts dumps getComputedStyle of every element (+ ::before/::after/::placeholder)
// for each scenario, then once more with :hover, :focus-visible and :active forced on every element at once
// (CDP CSS.forcePseudoState), plus a few root-attribute variants. Stricter than pixels: it sees states nothing renders.
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Geometry driven by wall-clock timing (the runner waterfall); the screenshot suite masks it too.
const LIVE = '.rn-wf';

type Dump = { props: string[]; rows: string[][]; els: Record<string, number>; cls: Record<string, string> };

// Runs in the page: element path -> index into a table of distinct style rows.
function collect(live: string): Dump {
  const custom = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      const style = (r as CSSStyleRule).style;
      if (style) for (let i = 0; i < style.length; i++) if (style[i].startsWith('--')) custom.add(style[i]);
      const inner = (r as CSSGroupingRule).cssRules;
      if (inner) walk(inner);
    }
  };
  for (const s of Array.from(document.styleSheets)) walk(s.cssRules);
  for (const el of Array.from(document.querySelectorAll('[style]')))
    for (const p of Array.from((el as HTMLElement).style)) if (p.startsWith('--')) custom.add(p);
  const longhands = Array.from(getComputedStyle(document.documentElement)).filter((p) => !p.startsWith('--'));
  const props = [...longhands, ...[...custom].sort()];
  const rows: string[][] = [];
  const rowIndex = new Map<string, number>();
  const els: Record<string, number> = {};
  const cls: Record<string, string> = {}; // class attribute per path, so a diff names the element
  const put = (key: string, cs: CSSStyleDeclaration) => {
    const row = props.map((p) => cs.getPropertyValue(p));
    const k = row.join('\u0001');
    let i = rowIndex.get(k);
    if (i === undefined) rowIndex.set(k, (i = rows.push(row) - 1));
    els[key] = i;
  };
  const visit = (el: Element, path: string) => {
    if (el.matches(live)) return;
    put(path, getComputedStyle(el));
    if (el.getAttribute('class')) cls[path] = el.getAttribute('class')!;
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content !== 'none' && cs.content !== 'normal') put(path + pseudo, cs);
    }
    if (el.matches('input, textarea')) put(path + '::placeholder', getComputedStyle(el, '::placeholder'));
    const counts: Record<string, number> = {};
    for (const c of Array.from(el.children)) {
      const t = c.tagName.toLowerCase();
      counts[t] = (counts[t] ?? 0) + 1;
      visit(c, `${path}/${t}[${counts[t]}]`);
    }
  };
  visit(document.documentElement, 'html');
  return { props, rows, els, cls };
}

const settle = (page: Page) =>
  page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    // Infinite animations (spinners) would make every dump differ: freeze them at t=0.
    for (const a of document.getAnimations()) {
      if (a.effect?.getComputedTiming().iterations !== Infinity) continue;
      a.pause();
      a.currentTime = 0;
    }
  });

/** Dump every state variant of the current page into `${dir}/${name}.json.gz`. */
export async function dumpComputedStyles(page: Page, dir: string, name: string): Promise<void> {
  const out: Record<string, Dump> = {};
  // Stop live updates (the gRPC stream ticks every second) so every variant sees the same DOM.
  // app.spec.ts installed a fake clock (setFixedTime); pausing it stops every timer and rAF.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1);
  await settle(page);
  out.plain = await page.evaluate(collect, LIVE);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '*' });
  const force = (forcedPseudoClasses: string[]) =>
    Promise.all(nodeIds.map((nodeId) => cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses })));
  for (const [variant, pseudo] of [
    ['hover', ['hover']],
    ['focus', ['focus', 'focus-visible', 'focus-within']],
    ['active', ['active', 'hover']],
  ] as const) {
    await force([...pseudo]);
    await settle(page);
    out[variant] = await page.evaluate(collect, LIVE);
  }
  await force([]);
  await cdp.detach();

  // App-level states the scenarios never reach: Settings → density (default compact), the native macOS
  // title bar, a sidebar row drag, the hidden sidebar. [variant, element, attribute ('class' adds a class), value]
  for (const [variant, sel, attr, value] of [
    ['density-normal', 'html', 'data-density', 'normal'],
    ['native-macos', 'html', 'data-native-macos', 'true'],
    ['row-dragging', 'html', 'class', 'bs-row-dragging'],
    ['sidebar-hidden', '.bs', 'class', 'sidebar-hidden'],
  ] as const) {
    const prev = await page.evaluate(
      ([s, a, v]) => {
        const el = document.querySelector(s);
        if (!el) return undefined;
        const p = el.getAttribute(a);
        if (a === 'class') el.classList.add(v);
        else el.setAttribute(a, v);
        return p;
      },
      [sel, attr, value] as const,
    );
    if (prev === undefined) continue;
    await settle(page);
    out[variant] = await page.evaluate(collect, LIVE);
    await page.evaluate(
      ([s, a, p]) => {
        const el = document.querySelector(s)!;
        if (p === null) el.removeAttribute(a);
        else el.setAttribute(a, p);
      },
      [sel, attr, prev] as const,
    );
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.json.gz`, gzipSync(JSON.stringify(out)));
}
