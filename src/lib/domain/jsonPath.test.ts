import { describe, it, expect } from 'vitest';
import { queryJsonPath } from './jsonPath';

const doc = {
  total: 3,
  results: [
    { id: 1, status: 'ok', tags: ['a', 'b'], meta: { n: 5 } },
    { id: 2, status: 'failed', tags: [], meta: { n: 10 } },
    { id: 3, status: 'failed', tags: ['c'] },
  ],
  'weird key': { x: 1 },
};
const q = (p: string) => queryJsonPath(doc, p);
const vals = (p: string) => {
  const r = q(p);
  if (!r.ok) throw new Error(r.error);
  return r.values;
};

describe('queryJsonPath', () => {
  it('root, keys, indexes', () => {
    expect(vals('$')).toEqual([doc]);
    expect(vals('$.total')).toEqual([3]);
    expect(vals('$.results[0].id')).toEqual([1]);
    expect(vals('$.results[-1].id')).toEqual([3]);
    expect(vals("$['weird key'].x")).toEqual([1]);
    expect(vals('$.nope.deeper')).toEqual([]);
  });
  it('wildcards and recursive descent', () => {
    expect(vals('$.results[*].id')).toEqual([1, 2, 3]);
    expect(vals('$.results.*.id')).toEqual([1, 2, 3]);
    expect(vals('$..id')).toEqual([1, 2, 3]);
    expect(vals('$..n')).toEqual([5, 10]);
    expect(vals('$.results[*].tags[0]')).toEqual(['a', 'c']);
  });
  it('filters', () => {
    expect(vals("$.results[?(@.status == 'failed')].id")).toEqual([2, 3]);
    expect(vals("$.results[?(@.status == 'failed' && @.id > 2)].id")).toEqual([3]);
    expect(vals('$.results[?(@.meta.n >= 10 || @.id == 1)].id')).toEqual([1, 2]);
    expect(vals('$.results[?(@.meta)].id')).toEqual([1, 2]);
    expect(vals('$.results[?(!@.meta)].id')).toEqual([3]);
    expect(vals("$.results[?(@.status != 'ok')].id")).toEqual([2, 3]);
  });
  it('reports errors instead of throwing', () => {
    expect(q('results').ok).toBe(false);
    expect(q('$.results[').ok).toBe(false);
    expect(q('$.results[?(@.a ==)]').ok).toBe(false);
    expect(q('$.a[1:2]').ok).toBe(false);
  });
});
