import { describe, it, expect } from 'vitest';
import { utf8Length } from './editorStats';

describe('utf8Length', () => {
  it('matches TextEncoder', () => {
    for (const s of ['', 'abc', 'привет', '€', '😀 x', '{"a":"é"}'])
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });
});
