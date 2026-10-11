import { describe, it, expect } from 'vitest';
import { autoChoices, fields, initialChoices, mergeFields, parseSide } from './mergeFields';

const base = { name: 'Create refund', headers: { Authorization: 'Bearer' }, timeout: 5000, body: { mode: 'json' } };
const mine = {
  name: 'Create refund',
  headers: { Authorization: 'Bearer', 'Idempotency-Key': '{{uuid}}' },
  timeout: 10000,
  body: { mode: 'json' },
};
const theirs = {
  name: 'Create refund',
  headers: { Authorization: 'Bearer', 'X-Retry-Policy': 'exp' },
  timeout: 30000,
  retries: 5,
  body: { mode: 'json' },
};

describe('field merge', () => {
  it('sees two new headers as two separate changes, not a conflict', () => {
    const fs = fields(base, mine, theirs);
    const byPath = Object.fromEntries(fs.map((f) => [f.path.join('.'), f.kind]));
    expect(byPath).toMatchObject({
      name: 'same',
      'headers.Idempotency-Key': 'mine',
      'headers.X-Retry-Policy': 'theirs',
      timeout: 'conflict',
      retries: 'theirs',
      'body.mode': 'same',
    });
  });

  it('merges what does not collide and waits for the conflict', () => {
    const fs = fields(base, mine, theirs);
    let choices = autoChoices(fs, initialChoices(fs));
    expect(mergeFields(mine, fs, choices, true)).toBeNull();
    choices = choices.map((c, i) => (fs[i].path[0] === 'timeout' ? 'theirs' : c));
    const merged = JSON.parse(mergeFields(mine, fs, choices, true)!);
    expect(merged).toEqual({
      name: 'Create refund',
      headers: { Authorization: 'Bearer', 'Idempotency-Key': '{{uuid}}', 'X-Retry-Policy': 'exp' },
      timeout: 30000,
      body: { mode: 'json' },
      retries: 5,
    });
  });

  it('deletes a field the chosen side removed', () => {
    const fs = fields({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 3 });
    expect(fs.find((f) => f.path[0] === 'b')?.kind).toBe('conflict');
    const choices = fs.map(() => 'mine' as const);
    expect(JSON.parse(mergeFields({ a: 1 }, fs, choices, false)!)).toEqual({ a: 1 });
  });

  it('keeps a subtree whole when the sides disagree on its shape', () => {
    const fs = fields({ body: { mode: 'json' } }, { body: 'raw' }, { body: { mode: 'form' } });
    expect(fs.map((f) => f.path.join('.'))).toEqual(['body']);
  });

  it('keeps a __proto__ key a plain field and never touches Object.prototype', () => {
    const theirs = parseSide('{"a": 1, "__proto__": {"polluted": true}}')!;
    const fs = fields({ a: 1 }, { a: 1 }, theirs);
    expect(fs.map((f) => f.path.join('.'))).toEqual(['a', '__proto__.polluted']);
    const out = mergeFields({ a: 1 }, fs, ['mine', 'theirs'], false)!;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out).toContain('"__proto__"');
  });

  it('only parses JSON objects', () => {
    expect(parseSide('{"a":1}')).toEqual({ a: 1 });
    expect(parseSide(null)).toEqual({});
    expect(parseSide('[1]')).toBeUndefined();
    expect(parseSide('{ broken')).toBeUndefined();
  });
});
