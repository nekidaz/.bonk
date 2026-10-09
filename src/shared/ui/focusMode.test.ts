import { describe, it, expect } from 'vitest';
import { expandTarget, oneLinePreview, toggleFocus } from './focusMode';

describe('focus mode', () => {
  it('toggle enters and leaves the same pane, switches between panes', () => {
    expect(toggleFocus(null, 'request')).toBe('request');
    expect(toggleFocus('request', 'request')).toBe(null);
    expect(toggleFocus('request', 'response')).toBe('response');
  });
  it('hotkey leaves when expanded, else picks the pane under focus', () => {
    expect(expandTarget(null, false)).toBe('request');
    expect(expandTarget(null, true)).toBe('response');
    expect(expandTarget('response', false)).toBe(null);
  });
});

describe('oneLinePreview', () => {
  it('minifies small JSON and collapses whitespace in text', () => {
    expect(oneLinePreview('{\n  "a": 1,\n  "b": [1, 2]\n}')).toBe('{"a":1,"b":[1,2]}');
    expect(oneLinePreview('  hello \n\n world  ')).toBe('hello world');
  });
  it('truncates and never parses big bodies', () => {
    const big = `{"x":"${'y'.repeat(100000)}"}`;
    const out = oneLinePreview(big, 20);
    expect(out.length).toBe(21);
    expect(out.endsWith('…')).toBe(true);
  });
});
