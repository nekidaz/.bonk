import { describe, it, expect } from 'vitest';
import { tokenizeLine } from './lineHighlight';

describe('tokenizeLine', () => {
  it('splits keys, strings, numbers and literals', () => {
    const line = '  "id": 12, "ok": true, "s": "a:b\\"c", "n": null,';
    const t = tokenizeLine(line).map(([s, e, k]) => [line.slice(s, e), k]);
    expect(t).toEqual([
      ['"id"', 'key'],
      ['12', 'lit'],
      ['"ok"', 'key'],
      ['true', 'lit'],
      ['"s"', 'key'],
      ['"a:b\\"c"', 'str'],
      ['"n"', 'key'],
      ['null', 'lit'],
    ]);
  });
  it('skips absurdly long lines', () => {
    expect(tokenizeLine('"a"'.repeat(5000))).toEqual([]);
  });
});
