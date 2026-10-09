import { describe, it, expect } from 'vitest';
import { describeSlice, scanFolds, shouldAutoFold } from './jsonFold';

const bigArray = (n: number, pretty = true) =>
  JSON.stringify(
    { items: Array.from({ length: n }, (_, i) => ({ id: i, s: 'a,]"b' })), tail: 1 },
    null,
    pretty ? 2 : 0,
  );

describe('scanFolds', () => {
  it('keeps 2 head + 2 tail elements and folds the middle of big arrays', () => {
    const text = bigArray(120);
    const { large } = scanFolds(text);
    expect(large).toHaveLength(1);
    const f = large[0];
    expect(f.hidden).toBe(116);
    expect(f.kind).toBe('objects');
    const before = text.slice(0, f.from);
    const after = text.slice(f.to);
    expect(before.endsWith('},')).toBe(true);
    expect(before.match(/"id"/g)).toHaveLength(2);
    expect(after.match(/"id"/g)).toHaveLength(2);
    expect(after.startsWith('\n    {')).toBe(true);
    expect(text.slice(f.from, f.to).match(/"id"/g)).toHaveLength(116);
  });

  it('leaves arrays of 50 or fewer elements alone', () => {
    expect(scanFolds(bigArray(50)).large).toHaveLength(0);
    expect(scanFolds(bigArray(51)).large).toHaveLength(1);
  });

  it('honours a custom threshold', () => {
    expect(scanFolds(bigArray(20), { min: 10 }).large).toHaveLength(1);
    expect(scanFolds(bigArray(120), { min: 200 }).large).toHaveLength(0);
  });

  it('works on minified text and primitive arrays', () => {
    const text = JSON.stringify(Array.from({ length: 80 }, (_, i) => i));
    const [f] = scanFolds(text).large;
    expect(f.kind).toBe('items');
    expect(f.hidden).toBe(76);
    expect(text.slice(0, f.from)).toBe('[0,1,');
    expect(text.slice(f.to)).toBe('78,79]');
  });

  it('drops folds hidden inside another fold but keeps those in the visible head/tail', () => {
    const inner = Array.from({ length: 60 }, (_, i) => i);
    const text = JSON.stringify(Array.from({ length: 60 }, () => inner));
    const { large } = scanFolds(text);
    expect(large).toHaveLength(5); // 2 head + 2 tail inner arrays + the outer middle
    large.forEach((a, i) => large.forEach((b, j) => i !== j && expect(a.from >= b.from && a.to <= b.to).toBe(false)));
  });

  it('never throws on broken input and ignores brackets inside strings', () => {
    expect(() => scanFolds('{"a": [1, 2, }}]]{{x}} "unterminated')).not.toThrow();
    expect(scanFolds('{"a": "[,,,,,,,", "b": 1}').large).toHaveLength(0);
  });

  it('lists multi-line containers except the root for Fold all', () => {
    const text = '{\n  "a": {\n    "b": 1\n  },\n  "c": [1, 2],\n  "d": [\n    3\n  ]\n}';
    const { containers } = scanFolds(text, { containers: true });
    expect(containers.map((c) => text.slice(c.from - 1, c.from))).toEqual(['{', '[']);
    expect(containers).toHaveLength(2);
  });
});

describe('describeSlice', () => {
  it('counts hidden elements of a large-array fold', () => {
    const text = bigArray(120);
    const [f] = scanFolds(text).large;
    expect(describeSlice(text.slice(f.from, f.to))).toEqual({ count: 116, kind: 'objects' });
  });
  it('counts whole-container contents', () => {
    expect(describeSlice('1, 2, 3')).toEqual({ count: 3, kind: 'items' });
    expect(describeSlice('[1,2],[3]')).toEqual({ count: 2, kind: 'arrays' });
    expect(describeSlice('')).toEqual({ count: 0, kind: 'items' });
  });
});

describe('shouldAutoFold', () => {
  it('thresholds', () => {
    expect(shouldAutoFold(10, 10)).toBe(false);
    expect(shouldAutoFold(300_000, 10)).toBe(true);
    expect(shouldAutoFold(10, 1000)).toBe(true);
  });
});
