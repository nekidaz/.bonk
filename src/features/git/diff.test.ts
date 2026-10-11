import { describe, it, expect } from 'vitest';
import { diffRows, diffStats, diffLineClass, fileLines, splitRows, changedSpan } from './diff';

const SAMPLE = [
  'diff --git a/a.json b/a.json',
  'index 111..222 100644',
  '--- a/a.json',
  '+++ b/a.json',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
].join('\n');

const MULTI_HUNK = [
  'diff --git a/b.json b/b.json',
  'index 333..444 100644',
  '--- a/b.json',
  '+++ b/b.json',
  '@@ -1,2 +1,2 @@',
  ' first',
  '-gone1',
  '+added1',
  '@@ -10,3 +20,3 @@',
  ' second',
  '-gone2',
  '+added2',
].join('\n');

describe('diff parser', () => {
  it('classifies lines', () => {
    expect(diffLineClass('@@ -1 +1 @@')).toBe('hunk');
    expect(diffLineClass('+added')).toBe('add');
    expect(diffLineClass('-removed')).toBe('del');
    expect(diffLineClass('--- a/x')).toBe('meta');
    expect(diffLineClass(' context')).toBe('');
  });

  it('counts additions and deletions, ignoring file headers', () => {
    expect(diffStats(SAMPLE)).toEqual({ additions: 1, deletions: 1 });
  });

  it('numbers add/del/context rows from the hunk header', () => {
    const rows = diffRows(SAMPLE);
    const ctx = rows.find((r) => r.text === ' keep')!;
    expect(ctx.oldLine).toBe('1');
    expect(ctx.newLine).toBe('1');
    const del = rows.find((r) => r.cls === 'del')!;
    expect(del.oldLine).toBe('2');
    expect(del.newLine).toBe('');
    const add = rows.find((r) => r.cls === 'add')!;
    expect(add.newLine).toBe('2');
    expect(add.oldLine).toBe('');
  });

  it('re-seeds line numbering at the second hunk header', () => {
    const rows = diffRows(MULTI_HUNK);
    // First hunk seeds at old=1/new=1.
    const first = rows.find((r) => r.text === ' first')!;
    expect(first.oldLine).toBe('1');
    expect(first.newLine).toBe('1');
    // Second hunk header (@@ -10,3 +20,3 @@) re-seeds the counters.
    const second = rows.find((r) => r.text === ' second')!;
    expect(second.oldLine).toBe('10');
    expect(second.newLine).toBe('20');
    const del2 = rows.find((r) => r.text === '-gone2')!;
    expect(del2.oldLine).toBe('11');
    expect(del2.newLine).toBe('');
    const add2 = rows.find((r) => r.text === '+added2')!;
    expect(add2.newLine).toBe('21');
    expect(add2.oldLine).toBe('');
  });

  it('excludes +++/--- file headers from +/- counts across multiple hunks', () => {
    // 2 additions (+added1, +added2) and 2 deletions (-gone1, -gone2); the
    // '--- a/b.json' and '+++ b/b.json' header lines must not be counted.
    expect(diffStats(MULTI_HUNK)).toEqual({ additions: 2, deletions: 2 });
  });
});

describe('full-file diff rows', () => {
  const text = [
    'diff --git a/x.json b/x.json',
    'index 1..2 100644',
    '--- a/x.json',
    '+++ b/x.json',
    '@@ -1,4 +1,5 @@',
    ' {',
    '-  "url": "/v1",',
    '+  "url": "/v1?limit=20",',
    '+  "accept": "json",',
    '   "x": 1',
    ' }',
    '\\ No newline at end of file',
  ].join('\n');

  it('numbers every line of the file and drops the headers', () => {
    const lines = fileLines(text);
    expect(lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['ctx', 3, 4],
      ['ctx', 4, 5],
    ]);
    expect(lines[1].text).toBe('  "url": "/v1",');
  });

  it('pairs removed and added lines, padding the shorter side', () => {
    const rows = splitRows(fileLines(text));
    expect(rows.map((r) => [r.left?.old, r.right?.new])).toEqual([
      [1, 1],
      [2, 2],
      [undefined, 3],
      [3, 4],
      [4, 5],
    ]);
  });

  it('finds the changed middle of a line', () => {
    const a = '"/v1/payments",';
    const b = '"/v1/payments?limit=20",';
    const [s, ea, eb] = changedSpan(a, b);
    expect(a.slice(s, ea)).toBe('');
    expect(b.slice(s, eb)).toBe('?limit=20');
    expect(changedSpan('same', 'same')).toEqual([4, 4, 4]);
  });
});
