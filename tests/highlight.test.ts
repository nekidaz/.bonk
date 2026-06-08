import { describe, it, expect } from 'vitest';
import {
  esc,
  hl,
  highlightJson,
  highlightMarkup,
  memoText,
  bodyEditorHtml,
  MAX_HIGHLIGHT_CHARS,
} from '../src/lib/domain/highlight';
import type { Tab } from '../src/lib/domain/types';

function tab(overrides: Partial<Tab['request']> = {}): Tab {
  return {
    id: 't1',
    protocol: 'http',
    title: 'T',
    request: { method: 'POST', url: 'https://api.example.com', headers: {}, ...overrides },
  };
}

describe('esc', () => {
  it('escapes the markup-significant characters & < >', () => {
    expect(esc('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escapes & before < and > so existing entities are not double-mangled', () => {
    // The & must be replaced first; otherwise &lt; would become &amp;lt;.
    expect(esc('<')).toBe('&lt;');
    expect(esc('&lt;')).toBe('&amp;lt;');
  });
  it('leaves double quotes untouched (markup highlighting relies on raw quotes)', () => {
    expect(esc('say "hi"')).toBe('say "hi"');
  });
  it('returns the empty string unchanged', () => {
    expect(esc('')).toBe('');
  });
});

describe('hl (JSON)', () => {
  it('produces token spans for keys, strings, numbers, booleans and punctuation', () => {
    const out = hl('{"a":1,"b":"x","c":true}');
    // keys carry the .k class and the colon the .pu class
    expect(out).toContain('<span class="k">"a"</span><span class="pu">:</span>');
    // numbers -> .n2, booleans -> .b2, value strings -> .s2, brackets/commas -> .br
    expect(out).toContain('<span class="n2">1</span>');
    expect(out).toContain('<span class="b2">true</span>');
    expect(out).toContain('<span class="s2">"x"</span>');
    expect(out).toContain('<span class="br">{</span>');
    expect(out).toContain('<span class="br">}</span>');
  });

  it('pretty-prints by default (reparses + 2-space indents) but leaves raw text when pretty=false', () => {
    const compact = '{"a":1}';
    // default pretty=true reflows onto multiple lines with two-space indentation
    expect(hl(compact)).toContain('\n  <span class="k">"a"</span>');
    // pretty=false keeps the original single-line layout
    const raw = hl(compact, false);
    expect(raw).not.toContain('\n');
    expect(raw).toContain('<span class="k">"a"</span>');
  });

  it('escapes HTML-significant characters inside JSON string values', () => {
    const out = hl('{"html":"<b>&</b>"}', false);
    expect(out).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    // and never emits a raw, unescaped opening tag
    expect(out).not.toContain('<b>');
  });

  it('falls back to the raw (escaped) text when the JSON cannot be parsed', () => {
    const out = hl('{not valid json', false);
    // no exception, and the unparseable text is escaped rather than tokenized as an object
    expect(typeof out).toBe('string');
    expect(out).toContain('not valid json');
  });
});

describe('highlightJson', () => {
  it('matches hl for parseable input and is callable directly', () => {
    expect(highlightJson('{"a":1}', false)).toBe(hl('{"a":1}', false));
  });
});

describe('highlightMarkup (HTML/XML)', () => {
  it('wraps a tag in .br delimiters + .tag name, with the attribute blob as one .attr span', () => {
    const out = highlightMarkup('<div class="x">hi</div>');
    expect(out).toContain('<span class="tag">div</span>');
    // the angle brackets become .br spans around the escaped delimiters
    expect(out).toContain('<span class="br">&lt;</span>');
    expect(out).toContain('<span class="br">&lt;/</span>');
    expect(out).toContain('<span class="br">&gt;</span>');
    // the whole attribute run (including the leading space) is a single .attr span
    expect(out).toContain('<span class="attr"> class="x"</span>');
    // text content between the tags is passed through (escaped) untouched
    expect(out).toContain('>hi<');
  });

  it('escapes the source before tokenizing so injected markup is inert', () => {
    const out = highlightMarkup('<p>1 < 2 & 3</p>');
    // the stray < and & inside text content are escaped, not turned into real tags
    expect(out).toContain('1 &lt; 2 &amp; 3');
  });

  it('works on XML as well as HTML', () => {
    const out = highlightMarkup('<note id="1">x</note>');
    expect(out).toContain('<span class="tag">note</span>');
    expect(out).toContain('<span class="attr"> id="1"</span>');
  });

  it('tokenizes a standalone attr=value pair (the name/eq/value branch) in text context', () => {
    // Outside a <...> tag, a bare name='value' hits the second alternative,
    // emitting separate .attr / .pu / .s2 spans. Note `esc` does NOT escape
    // double quotes, so only single-quoted values match this value group.
    const out = highlightMarkup("data-id='42'");
    expect(out).toContain('<span class="attr">data-id</span>');
    expect(out).toContain('<span class="pu">=</span>');
    expect(out).toContain("<span class=\"s2\">'42'</span>");
  });
});

describe('plain text', () => {
  it('hl on plain (non-JSON) text just escapes it', () => {
    expect(hl('a < b & c', false)).toBe('a &lt; b &amp; c');
  });
  it('highlightMarkup on text with no tags just escapes it', () => {
    expect(highlightMarkup('a < b')).toBe('a &lt; b');
  });
});

describe('MAX_HIGHLIGHT_CHARS truncation / escape-only path', () => {
  it('exposes the documented cap', () => {
    expect(MAX_HIGHLIGHT_CHARS).toBe(180_000);
  });

  it('hl on oversized JSON escapes without emitting token spans', () => {
    // A valid JSON array whose compact form already exceeds the cap.
    const big = JSON.stringify(Array.from({ length: 40_000 }, (_, i) => i));
    expect(big.length).toBeGreaterThan(MAX_HIGHLIGHT_CHARS);
    const out = hl(big, false);
    expect(out).not.toContain('<span');
  });

  it('hl escapes HTML-significant characters on the oversized path', () => {
    const oversized = '<' + 'a'.repeat(MAX_HIGHLIGHT_CHARS + 1);
    const out = hl(oversized, false);
    expect(out.startsWith('&lt;')).toBe(true);
    expect(out).not.toContain('<span');
  });

  it('highlightMarkup on oversized input is escape-only', () => {
    const oversized = '<div>' + 'x'.repeat(MAX_HIGHLIGHT_CHARS);
    const out = highlightMarkup(oversized);
    expect(out.startsWith('&lt;div&gt;')).toBe(true);
    expect(out).not.toContain('<span');
  });
});

describe('caching / consistency', () => {
  it('hl returns identical output across repeated calls (memoized)', () => {
    const src = '{"repeat":42}';
    const first = hl(src, false);
    const second = hl(src, false);
    expect(second).toBe(first);
  });

  it('hl keys the cache on the pretty flag (different layout per flag)', () => {
    const src = '{"a":1}';
    expect(hl(src, true)).not.toBe(hl(src, false));
    // and each flag is internally stable
    expect(hl(src, true)).toBe(hl(src, true));
  });

  it('highlightMarkup returns identical output across repeated calls', () => {
    const src = '<span id="z">q</span>';
    expect(highlightMarkup(src)).toBe(highlightMarkup(src));
  });

  it('memoText computes once and serves the cached value thereafter', () => {
    const cache = new Map<string, number>();
    let calls = 0;
    const make = () => {
      calls += 1;
      return 7;
    };
    expect(memoText(cache, 'k', make)).toBe(7);
    expect(memoText(cache, 'k', make)).toBe(7);
    expect(calls).toBe(1);
  });
});

describe('bodyEditorHtml', () => {
  it('JSON-highlights a raw JSON body (no reflow: pretty=false)', () => {
    const out = bodyEditorHtml(tab({ body: '{"a":1}', bodyMode: 'raw', rawBodyFormat: 'JSON' }));
    expect(out).toContain('<span class="k">"a"</span>');
    expect(out).not.toContain('\n'); // pretty=false keeps the author's layout
  });

  it('markup-highlights an HTML body', () => {
    const out = bodyEditorHtml(tab({ body: '<b>hi</b>', bodyMode: 'raw', rawBodyFormat: 'HTML' }));
    expect(out).toContain('<span class="tag">b</span>');
  });

  it('markup-highlights an XML body', () => {
    const out = bodyEditorHtml(tab({ body: '<x a="1"/>', bodyMode: 'raw', rawBodyFormat: 'XML' }));
    expect(out).toContain('<span class="tag">x</span>');
  });

  it('escape-only for a plain Text body', () => {
    const out = bodyEditorHtml(tab({ body: 'a < b & c', bodyMode: 'raw', rawBodyFormat: 'Text' }));
    expect(out).toBe('a &lt; b &amp; c');
  });

  it('treats an undefined tab as an empty JSON body', () => {
    expect(bodyEditorHtml(undefined)).toBe('');
  });
});
