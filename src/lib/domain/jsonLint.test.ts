import { describe, expect, it } from 'vitest';
import { jsonProblem } from './jsonLint';

describe('jsonProblem', () => {
  it('accepts valid JSON, empty text and {{var}} placeholders', () => {
    expect(jsonProblem('{"a": [1, 2]}')).toBeNull();
    expect(jsonProblem('  ')).toBeNull();
    expect(jsonProblem('{"id": {{id}}, "key": "{{$uuid}}"}')).toBeNull();
  });
  it('points at the broken spot', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    const p = jsonProblem(text);
    expect(p).not.toBeNull();
    expect(text.slice(p!.pos, p!.pos + 3)).toBe('"b"');
  });
});
