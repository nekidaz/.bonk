import type { Tab } from './types';
import { currentRawFormat } from './httpBody';

/**
 * Pure syntax-highlight subsystem shared by the request-body editor and the
 * response view. Produces HTML strings of token `<span>`s for JSON and
 * HTML/XML markup, with a plain-text escape fallback.
 *
 * The memo caches are module-scoped (previously component-scoped in App.svelte);
 * memoization behavior is unchanged — same keys, same LRU eviction, same
 * truncation at `MAX_HIGHLIGHT_CHARS`.
 */

/** Above this many characters, highlighting degrades to escape-only output. */
export const MAX_HIGHLIGHT_CHARS = 180_000;
const MAX_TEXT_CACHE_ENTRIES = 32;

const highlightCache = new Map<string, string>();
const markupHighlightCache = new Map<string, string>();
const lineNumberCache = new Map<string, number[]>();

/** Escape the HTML-significant characters so raw text can't inject markup. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Memoize `create()` keyed by `key` in `cache`, evicting the oldest entry once
 * the cache exceeds `MAX_TEXT_CACHE_ENTRIES` (insertion-order LRU).
 */
export function memoText<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = create();
  cache.set(key, value);
  if (cache.size > MAX_TEXT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/** Highlight JSON, caching the result unless the input is oversized. */
export function hl(raw: string, pretty = true): string {
  if (raw.length > MAX_HIGHLIGHT_CHARS) return highlightJson(raw, pretty);
  const cacheKey = `${pretty ? '1' : '0'}:${raw}`;
  return memoText(highlightCache, cacheKey, () => highlightJson(raw, pretty));
}

/**
 * Render JSON as highlighted HTML. When `pretty`, the input is reparsed and
 * re-stringified with 2-space indentation; invalid JSON falls back to the raw
 * text. Oversized output is escape-only (no token spans).
 */
export function highlightJson(raw: string, pretty = true): string {
  // Past the cap the output is escape-only regardless, so skip the parse +
  // re-stringify entirely — parsing megabytes just to discard the result is the
  // CPU spike we want to avoid on large responses.
  if (raw.length > MAX_HIGHLIGHT_CHARS) return esc(raw);
  let p: string;
  try {
    p = pretty ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
  } catch {
    p = raw;
  }
  if (p.length > MAX_HIGHLIGHT_CHARS) return esc(p);
  return esc(p).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
    (m, str, colon, bool, num, punct) => {
      if (str) return colon ? `<span class="k">${str}</span><span class="pu">${colon}</span>` : `<span class="s2">${str}</span>`;
      if (bool) return `<span class="b2">${bool}</span>`;
      if (num) return `<span class="n2">${num}</span>`;
      if (punct) return `<span class="br">${punct}</span>`;
      return m;
    },
  );
}

/** Highlight HTML/XML markup, caching the result unless the input is oversized. */
export function highlightMarkup(raw: string): string {
  if (raw.length > MAX_HIGHLIGHT_CHARS) return esc(raw);
  return memoText(markupHighlightCache, raw, () => {
    return esc(raw).replace(
    /(&lt;\/?)([A-Za-z][\w:.-]*)([^&]*?)(&gt;)|(\b[A-Za-z_:][\w:.-]*)(=)(&quot;.*?&quot;|'.*?')/g,
    (m, open, tag, attrs, close, attr, eq, val) => {
      if (tag) return `<span class="br">${open}</span><span class="tag">${tag}</span><span class="attr">${attrs}</span><span class="br">${close}</span>`;
      if (attr) return `<span class="attr">${attr}</span><span class="pu">${eq}</span><span class="s2">${val}</span>`;
      return m;
    },
    );
  });
}

/**
 * Highlighted HTML for a tab's request body, dispatched by its raw format:
 * JSON gets JSON highlighting, HTML/XML get markup highlighting, everything
 * else is escape-only. Pure: depends only on the tab and the moved fns.
 */
export function bodyEditorHtml(t: Tab | undefined): string {
  const body = t?.request.body ?? '';
  const format = currentRawFormat(t);
  if (format === 'JSON') return hl(body, false);
  if (format === 'HTML' || format === 'XML') return highlightMarkup(body);
  return esc(body);
}

/**
 * The 1-based line numbers for `raw`, used by the code-editor gutters. Memoized
 * (module-scoped, insertion-order LRU) unless the input is oversized; the cache
 * is shared by every editor, which is harmless since the result depends only on
 * the text.
 */
export function lineNumbers(raw: string | undefined): number[] {
  const text = raw ?? '';
  const create = () => {
    let count = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) count += 1;
    }
    return Array.from({ length: count }, (_, i) => i + 1);
  };
  if (text.length > MAX_HIGHLIGHT_CHARS) return create();
  return memoText(lineNumberCache, text, () => {
    return create();
  });
}

/**
 * Keep an editor's gutter + highlight layers scroll-locked to its textarea.
 * The highlight layer is the textarea's previous sibling; the gutter is a
 * `.bs-json-gutter` under the same parent.
 */
export function syncJsonScroll(e: Event): void {
  const textarea = e.currentTarget as HTMLTextAreaElement;
  const highlight = textarea.previousElementSibling as HTMLElement | null;
  const gutter = textarea.parentElement?.querySelector<HTMLElement>('.bs-json-gutter');
  if (highlight) {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }
  if (gutter) gutter.scrollTop = textarea.scrollTop;
}

/**
 * Re-indent HTML/XML markup onto one tag per line for the Beautify action and
 * the response pretty view. Void elements don't increase depth. Oversized input
 * is returned unchanged.
 */
export function formatMarkup(raw: string): string {
  if (raw.length > MAX_HIGHLIGHT_CHARS) return raw;
  return raw
    .replace(/>\s+</g, '><')
    .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
    .split('\n')
    .reduce((lines, line) => {
      const trimmed = line.trim();
      if (!trimmed) return lines;
      if (/^<\//.test(trimmed)) lines.depth = Math.max(lines.depth - 1, 0);
      lines.out.push(`${'  '.repeat(lines.depth)}${trimmed}`);
      if (/^<[^!?/][^>]*[^/]>\s*$/.test(trimmed) && !/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(trimmed)) {
        lines.depth += 1;
      }
      return lines;
    }, { depth: 0, out: [] as string[] }).out.join('\n');
}
