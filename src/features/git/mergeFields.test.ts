import { describe, it, expect } from 'vitest';
import {
  autoChoices,
  fields,
  initialChoices,
  mergeFields,
  parseSide,
  parseValue,
  type FieldChoice,
  type Obj,
} from './mergeFields';

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

const kinds = (b: Obj, m: Obj, t: Obj) => Object.fromEntries(fields(b, m, t).map((f) => [f.label, f.kind]));
/** Merge with every open field decided by `pick` (by label). */
function merge(b: Obj, m: Obj, t: Obj, pick: Record<string, FieldChoice> = {}): Obj {
  const fs = fields(b, m, t);
  const choices = autoChoices(fs, initialChoices(fs)).map((c, i) => pick[fs[i].label] ?? c);
  const out = mergeFields(b, m, t, fs, choices, false);
  if (out === null) throw new Error('undecided');
  return JSON.parse(out);
}

describe('field merge', () => {
  it('sees two new headers as two separate changes, not a conflict', () => {
    expect(kinds(base, mine, theirs)).toMatchObject({
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
    expect(mergeFields(base, mine, theirs, fs, autoChoices(fs, initialChoices(fs)), true)).toBeNull();
    expect(merge(base, mine, theirs, { timeout: 'theirs' })).toEqual({
      name: 'Create refund',
      headers: { Authorization: 'Bearer', 'Idempotency-Key': '{{uuid}}', 'X-Retry-Policy': 'exp' },
      timeout: 30000,
      body: { mode: 'json' },
      retries: 5,
    });
  });

  it("keeps mine's additions before theirs at the same spot", () => {
    const out = merge(base, mine, theirs, { timeout: 'mine' });
    expect(Object.keys(out.headers as Obj)).toEqual(['Authorization', 'Idempotency-Key', 'X-Retry-Policy']);
  });

  it('deletes a field the chosen side removed', () => {
    expect(kinds({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 3 }).b).toBe('conflict');
    expect(merge({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 3 }, { b: 'mine' })).toEqual({ a: 1 });
  });

  it('keeps a subtree whole when the sides disagree on its shape', () => {
    expect(Object.keys(kinds({ body: { mode: 'json' } }, { body: 'raw' }, { body: { mode: 'form' } }))).toEqual([
      'body',
    ]);
  });

  it('drops a container whose only addition was turned down', () => {
    expect(merge({}, { auth: { type: 'bearer' } }, {}, { 'auth.type': 'theirs' })).toEqual({});
  });

  it('uses a value typed by hand, and removes the field for an empty one', () => {
    const b = { t: 1, u: 1 };
    const m = { t: 2, u: 1 };
    const t = { t: 3, u: 2 };
    expect(merge(b, m, t, { t: { value: parseValue('25') }, u: { value: parseValue('') } })).toEqual({ t: 25 });
    expect(() => parseValue('{ nope')).toThrow();
  });

  it('keeps a __proto__ key a plain field and never touches Object.prototype', () => {
    const t = parseSide('{"a": 1, "__proto__": {"polluted": true}}')!;
    expect(Object.keys(kinds({ a: 1 }, { a: 1 }, t))).toEqual(['a', '__proto__.polluted']);
    const out = merge({ a: 1 }, { a: 1 }, t);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
  });

  it('only parses JSON objects', () => {
    expect(parseSide('{"a":1}')).toEqual({ a: 1 });
    expect(parseSide(null)).toEqual({});
    expect(parseSide('[1]')).toBeUndefined();
    expect(parseSide('{ broken')).toBeUndefined();
  });
});

describe('field merge of arrays', () => {
  const p = (key: string, value: string) => ({ key, value, enabled: true });

  it('matches params by key, so edits to different params never collide', () => {
    const b = { params: [p('limit', '20'), p('status', 'captured')] };
    const m = { params: [p('limit', '50'), p('status', 'captured')] };
    const t = { params: [p('limit', '20'), p('status', 'refunded')] };
    expect(kinds(b, m, t)).toMatchObject({ 'params[limit].value': 'mine', 'params[status].value': 'theirs' });
    expect(merge(b, m, t).params).toEqual([p('limit', '50'), p('status', 'refunded')]);
  });

  it('does not shift elements when one side inserts at the start', () => {
    const b = { params: [p('a', '1'), p('b', '1')] };
    const m = { params: [p('new', '0'), p('a', '1'), p('b', '1')] };
    const t = { params: [p('a', '1'), p('b', '2')] };
    expect(kinds(b, m, t)).toMatchObject({
      'params[new]': 'mine',
      'params[b].value': 'theirs',
      'params[a].value': 'same',
    });
    expect(merge(b, m, t).params).toEqual([p('new', '0'), p('a', '1'), p('b', '2')]);
  });

  it('puts what theirs added after its neighbour there, and drops what a side removed', () => {
    const b = { params: [p('a', '1'), p('b', '1'), p('c', '1')] };
    const m = { params: [p('a', '1'), p('c', '1')] };
    const t = { params: [p('a', '1'), p('x', '9'), p('b', '1'), p('c', '1')] };
    expect(kinds(b, m, t)).toMatchObject({ 'params[b]': 'mine', 'params[x]': 'theirs' });
    expect((merge(b, m, t).params as { key: string }[]).map((e) => e.key)).toEqual(['a', 'x', 'c']);
  });

  it('tells repeated keys apart by occurrence', () => {
    const b = { params: [p('tag', 'a'), p('tag', 'b')] };
    const m = { params: [p('tag', 'a'), p('tag', 'B')] };
    const t = { params: [p('tag', 'A'), p('tag', 'b')] };
    expect(kinds(b, m, t)).toMatchObject({ 'params[tag].value': 'theirs', 'params[tag #2].value': 'mine' });
    expect(merge(b, m, t).params).toEqual([p('tag', 'A'), p('tag', 'B')]);
  });

  it('merges a list of plain values as a set of additions and removals', () => {
    const b = { disabledHeaders: ['Accept', 'X-Debug'] };
    const m = { disabledHeaders: ['Accept', 'X-Debug', 'Cookie'] };
    const t = { disabledHeaders: ['Accept'] };
    expect(kinds(b, m, t)).toMatchObject({
      'disabledHeaders["Accept"]': 'same',
      'disabledHeaders["X-Debug"]': 'theirs',
      'disabledHeaders["Cookie"]': 'mine',
    });
    expect(merge(b, m, t).disabledHeaders).toEqual(['Accept', 'Cookie']);
  });

  it('is a conflict when one side edits an element the other removed', () => {
    const b = { params: [p('a', '1')] };
    expect(kinds(b, { params: [p('a', '2')] }, { params: [] })['params[a]']).toBe('conflict');
  });
});
