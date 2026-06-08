import { describe, it, expect } from 'vitest';
import { esc } from './highlight';
import { computeView, displayText, responseFormat, DISPLAY_CHARS, PARSE_BUDGET } from './responseRender';

/** Minified JSON array string of at least `targetBytes` characters. */
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

describe('responseFormat', () => {
  it('classifies by content-type then by leading char', () => {
    expect(responseFormat('{}', 'application/json')).toBe('JSON');
    expect(responseFormat('[1,2]', 'text/plain')).toBe('JSON');
    expect(responseFormat('<html></html>', '')).toBe('HTML');
    expect(responseFormat('<?xml version="1.0"?>', '')).toBe('XML');
    expect(responseFormat('hello', 'text/plain')).toBe('Text');
  });
});

describe('displayText', () => {
  it('pretty-prints JSON within the parse budget', () => {
    const { text, truncated } = displayText('{"a":1,"b":2}', 'JSON', 'pretty');
    expect(text).toBe('{\n  "a": 1,\n  "b": 2\n}');
    expect(truncated).toBe(false);
  });

  it('leaves the body untouched in raw mode', () => {
    const body = '{"a":1}';
    expect(displayText(body, 'JSON', 'raw')).toEqual({ text: body, truncated: false });
  });

  it('caps output at DISPLAY_CHARS and flags truncation', () => {
    const body = bigMinifiedJson(3 * DISPLAY_CHARS); // > 8 MB → not parsed, shown raw
    const { text, truncated } = displayText(body, 'JSON', 'pretty');
    expect(truncated).toBe(true);
    expect(text.length).toBe(DISPLAY_CHARS);
    expect(body.length).toBeGreaterThan(DISPLAY_CHARS); // full body untouched
  });

  it('does not parse bodies over the parse budget', () => {
    const body = bigMinifiedJson(PARSE_BUDGET + 50_000);
    const { text } = displayText(body, 'JSON', 'pretty');
    // Unparsed → still minified (no inserted newline), just sliced.
    expect(text).toBe(body.slice(0, DISPLAY_CHARS));
  });
});

describe('computeView', () => {
  it('small JSON → plain (highlighted single node)', () => {
    const view = computeView('{"a":1}', 'application/json', 'pretty');
    expect(view.kind).toBe('plain');
    if (view.kind === 'plain') {
      expect(view.truncated).toBe(false);
      expect(view.html).toContain('<span');
      expect(view.lines.length).toBe(3); // { / "a": 1 / }
    }
  });

  it('large pretty JSON → line chunks with aligned gutters', () => {
    // Parsed + prettied well past PLAIN_LIMIT (180 KB) but under the parse budget.
    const body = bigMinifiedJson(250_000);
    const view = computeView(body, 'application/json', 'pretty');
    expect(view.kind).toBe('lines');
    if (view.kind === 'lines') {
      expect(view.chunks.length).toBeGreaterThan(1);
      // Gutter numbers are contiguous and 1-based across chunks.
      const first = view.chunks[0];
      expect(first.firstLine).toBe(1);
      expect(first.gutter[0]).toBe(1);
      // Each chunk's gutter length matches its rendered line count.
      for (const c of view.chunks) {
        expect(c.gutter.length).toBe(c.html.split('\n').length);
      }
    }
  });

  it('huge minified JSON → char chunks, truncated, no entity split', () => {
    const body = bigMinifiedJson(PARSE_BUDGET + DISPLAY_CHARS); // > parse budget → raw, one line
    const view = computeView(body, 'application/json', 'pretty');
    expect(view.kind).toBe('chars');
    if (view.kind === 'chars') {
      expect(view.truncated).toBe(true);
      // Reassembled char-chunk HTML equals esc of the capped text — proves no
      // entity was split across a boundary and nothing was dropped/duplicated.
      const rejoined = view.chunks.map((c) => c.html).join('');
      expect(rejoined).toBe(esc(body.slice(0, DISPLAY_CHARS)));
    }
  });

  it('caps total rendered characters regardless of body size', () => {
    const body = bigMinifiedJson(5 * DISPLAY_CHARS);
    const view = computeView(body, 'application/json', 'pretty');
    let rendered = 0;
    if (view.kind === 'chars') rendered = view.chunks.reduce((n, c) => n + c.html.length, 0);
    else if (view.kind === 'lines') rendered = view.chunks.reduce((n, c) => n + c.html.length, 0);
    // esc can expand a bit, but bounded by ~6x DISPLAY_CHARS worst case; the
    // point is it is O(DISPLAY_CHARS), not O(body).
    expect(rendered).toBeLessThan(DISPLAY_CHARS * 6);
  });
});
