import { hl, highlightMarkup, esc, lineNumbers, formatMarkup, MAX_HIGHLIGHT_CHARS } from './highlight';

/**
 * Pure render pipeline for response bodies, shared by ResponseView and the perf
 * benchmark. Tauri-independent and side-effect-free except for the WeakMap memo
 * in {@link buildView}, so it can be unit-tested and profiled without a webview.
 *
 * The job: turn an arbitrarily large body (up to the 25 MB fetch cap) into a
 * bounded, renderable {@link ResponseView} without ever handing the DOM 50 MB.
 * Three strategies, picked by size and shape:
 *  - 'plain': small enough to syntax-highlight and render as one node.
 *  - 'lines': large but line-broken (pretty JSON) — gutter+code chunks per line.
 *  - 'chars': large with very long lines (minified JSON) — pre-wrapped char
 *    windows, no gutter.
 * Both chunked kinds are rendered with `content-visibility: auto`, so the
 * webview virtualizes off-screen slices natively — no JS scroll handler, so the
 * UI never re-renders on scroll.
 */

export type RenderMode = 'pretty' | 'raw' | 'preview';
export type ResponseFormat = 'JSON' | 'HTML' | 'XML' | 'Text';

export type LineChunk = { firstLine: number; gutter: number[]; html: string; estPx: number };
export type CharChunk = { offset: number; html: string; estPx: number };
export type ResponseView =
  | { kind: 'plain'; html: string; lines: number[]; truncated: boolean }
  | { kind: 'lines'; chunks: LineChunk[]; truncated: boolean }
  | { kind: 'chars'; chunks: CharChunk[]; truncated: boolean };

/**
 * Hard cap on how many characters we ever turn into DOM/HTML. The full body
 * stays available to the caller for Copy — we just refuse to format, highlight,
 * and render a multi-MB blob the webview can't survive.
 */
export const DISPLAY_CHARS = 1_000_000;
/**
 * Above this, never JSON.parse / re-indent markup — a multi-MB parse + restring
 * freezes the UI thread for hundreds of ms. Such bodies are shown raw (capped).
 */
export const PARSE_BUDGET = 8_000_000;
/**
 * At/below the highlight cap we keep the rich single-node path. Above it,
 * highlighting is skipped anyway (see highlight.ts), so the chunked text is
 * always escape-only — no token span ever crosses a line, making any split safe.
 */
export const PLAIN_LIMIT = MAX_HIGHLIGHT_CHARS;
const CHUNK_LINES = 200;
const CHUNK_CHARS = 24_000;
/** Avg chars/line above which we treat the body as "long-line" and char-chunk. */
const LONG_LINE_AVG = 200;
/**
 * 12.5px font * 1.75 line-height (see .bs-code). Only an off-screen estimate;
 * `contain-intrinsic-size: auto` remembers the real size after first render.
 */
const LINE_PX = 21.875;
/** Rough visual columns per wrapped line, for char-chunk height estimates. */
const WRAP_COLS = 90;

/** Classify a body by content-type header, falling back to a leading-char sniff. */
export function responseFormat(body: string, contentType: string): ResponseFormat {
  const ct = contentType.toLowerCase();
  const trimmed = body.trim();
  if (ct.includes('json') || /^[\[{]/.test(trimmed)) return 'JSON';
  if (ct.includes('html') || /^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'HTML';
  if (ct.includes('xml') || /^<\?xml/i.test(trimmed)) return 'XML';
  return 'Text';
}

function findJsonEnd(text: string, start: number): number | undefined {
  const opener = text[start];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : '';
  if (!closer) return undefined;
  const stack = [closer];
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return undefined;
}

function prettyEmbeddedJson(raw: string): string | undefined {
  if (raw.length > MAX_HIGHLIGHT_CHARS) return undefined;
  const start = raw.search(/[\[{]/);
  if (start === -1) return undefined;
  const end = findJsonEnd(raw, start);
  if (end === undefined) return undefined;
  const json = raw.slice(start, end);
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return undefined;
  }
}

/**
 * The text we actually display, plus whether we capped it. Formatting (pretty
 * JSON / markup re-indent) runs only within PARSE_BUDGET; past that the raw body
 * is shown. The result is hard-capped at DISPLAY_CHARS so the renderer never
 * receives more than ~1 MB regardless of how big the response was.
 */
export function displayText(body: string, format: ResponseFormat, mode: RenderMode): { text: string; truncated: boolean } {
  let text = body;
  if (mode !== 'raw' && body.length <= PARSE_BUDGET) {
    if (format === 'JSON') {
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        text = prettyEmbeddedJson(body) ?? body;
      }
    } else if ((format === 'HTML' || format === 'XML') && body.length <= MAX_HIGHLIGHT_CHARS) {
      text = formatMarkup(body);
    }
  }
  if (text.length > DISPLAY_CHARS) return { text: text.slice(0, DISPLAY_CHARS), truncated: true };
  return { text, truncated: false };
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function responseHtmlFromText(text: string, format: ResponseFormat): string {
  if (format === 'JSON') return hl(text, false);
  if (format === 'HTML' || format === 'XML') return highlightMarkup(text);
  return esc(text);
}

/**
 * Compute the render view for a body. Pure (no memo) — this is the function the
 * benchmark times. Production code should call {@link buildView} for caching.
 */
export function computeView(body: string, contentType: string, mode: RenderMode): ResponseView {
  const format = responseFormat(body, contentType);
  const { text, truncated } = displayText(body, format, mode);

  if (text.length <= PLAIN_LIMIT) {
    // Small: full highlight + single node.
    return { kind: 'plain', html: responseHtmlFromText(text, format), lines: lineNumbers(text), truncated };
  }
  if (countNewlines(text) + 1 >= text.length / LONG_LINE_AVG) {
    // Large + line-broken: escape-only (highlight skipped past PLAIN_LIMIT), so
    // no span crosses a newline — split into gutter+code chunks by line.
    const htmlLines = esc(text).split('\n');
    const chunks: LineChunk[] = [];
    for (let i = 0; i < htmlLines.length; i += CHUNK_LINES) {
      const slice = htmlLines.slice(i, i + CHUNK_LINES);
      chunks.push({
        firstLine: i + 1,
        gutter: Array.from({ length: slice.length }, (_, j) => i + j + 1),
        html: slice.join('\n'),
        estPx: slice.length * LINE_PX,
      });
    }
    return { kind: 'lines', chunks, truncated };
  }
  // Large + very long lines (e.g. minified JSON): pre-wrapped char windows. esc
  // each raw slice (not a pre-esc'd string) so an HTML entity can never be split
  // across a chunk boundary.
  const chunks: CharChunk[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) {
    const slice = text.slice(i, i + CHUNK_CHARS);
    chunks.push({ offset: i, html: esc(slice), estPx: Math.ceil(slice.length / WRAP_COLS) * LINE_PX });
  }
  return { kind: 'chars', chunks, truncated };
}

// Memo keyed by source object → (mode:content-type). A large body is processed
// exactly once, never on unrelated reactive updates.
const viewCache = new WeakMap<object, Map<string, ResponseView>>();

/** Memoized {@link computeView} for a response/result object. */
export function buildView(source: { body: string }, contentType: string, mode: RenderMode): ResponseView {
  const key = `${mode}:${contentType}`;
  let byMode = viewCache.get(source);
  if (!byMode) {
    byMode = new Map();
    viewCache.set(source, byMode);
  }
  const cached = byMode.get(key);
  if (cached) return cached;
  const view = computeView(source.body, contentType, mode);
  byMode.set(key, view);
  return view;
}
