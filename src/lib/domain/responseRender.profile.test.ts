import { describe, it, expect } from 'vitest';
import { esc } from './highlight';
import { computeView, DISPLAY_CHARS } from './responseRender';

/**
 * CPU profile for the response render pipeline. Not an assertion suite — it
 * times `computeView` against the "naive" cost of formatting the whole body, to
 * show the work avoided on large responses. Run:
 *
 *   npm test -- responseRender.profile
 *
 * GPU cannot be profiled headlessly (no compositor in node). To profile GPU in
 * the real app: `npm run app`, open Safari Web Inspector against the webview
 * (Develop ▸ <app> ▸ webview), Timelines tab → record while loading a large
 * response and scrolling. Watch the Layers sidebar: with content-visibility the
 * off-screen chunks should show no backing store / no paint, and the composited
 * layer height stays bounded instead of one multi-MB tile. Memory tab: heap
 * should track ~DISPLAY_CHARS of rendered text, not the full body size.
 */

function bigMinifiedJson(targetBytes: number): string {
  const parts: string[] = ['['];
  let size = 1;
  let i = 0;
  while (size < targetBytes) {
    const rec = `${i ? ',' : ''}{"id":${i},"name":"item-${i}","value":${i * 7},"active":${i % 2 === 0},"tags":["a","b","c"]}`;
    parts.push(rec);
    size += rec.length;
    i += 1;
  }
  parts.push(']');
  return parts.join('');
}

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/** What rendering the whole body used to cost: parse + pretty + escape, all of it. */
function naiveFullRender(body: string): void {
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    pretty = body;
  }
  esc(pretty);
}

describe('responseRender CPU profile', () => {
  it('computeView stays cheap as body size grows', () => {
    const sizesMb = [1, 8, 25];
    const rows: string[] = [];
    for (const mb of sizesMb) {
      const body = bigMinifiedJson(mb * 1024 * 1024);
      // computeView is unmemoized (the memo lives in buildView), so each call
      // does the full work — no need to vary the input.
      const tNew = ms(() => computeView(body, 'application/json', 'pretty'));
      const tNaive = ms(() => naiveFullRender(body));
      rows.push(
        `${String(mb).padStart(3)} MB | computeView ${tNew.toFixed(1).padStart(7)} ms | naive-full ${tNaive
          .toFixed(1)
          .padStart(8)} ms | speedup ${(tNaive / Math.max(tNew, 0.001)).toFixed(1).padStart(5)}x`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n  Render pipeline CPU (display cap = ${(DISPLAY_CHARS / 1024 / 1024).toFixed(1)} MB)\n  ` +
        rows.join('\n  ') +
        '\n',
    );
    // Sanity: the pipeline must not blow up — 25 MB should still finish fast.
    const big = bigMinifiedJson(25 * 1024 * 1024);
    expect(ms(() => computeView(big, 'application/json', 'pretty'))).toBeLessThan(2000);
  }, 60_000);
});
