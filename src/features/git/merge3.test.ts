import { describe, it, expect } from 'vitest';
import { autoResolve, initialResolution, lineHunks, merge3, mergedText, resolvedLines } from './merge3';

const L = (s: string) => s.split('\n');

describe('lineHunks', () => {
  it('finds a replaced line and an insertion', () => {
    expect(lineHunks(L('a\nb\nc'), L('a\nB\nc\nd'))).toEqual([
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
      { aStart: 3, aEnd: 3, bStart: 3, bEnd: 4 },
    ]);
    expect(lineHunks(L('x'), L('x'))).toEqual([]);
  });
});

describe('merge3', () => {
  const base = L('{\n  "a": 1,\n  "t": 10,\n  "z": 0\n}');
  const mine = L('{\n  "a": 1,\n  "k": "uuid",\n  "t": 10,\n  "z": 0\n}');
  const theirs = L('{\n  "a": 1,\n  "t": 30,\n  "z": 0\n}');

  it('keeps non-overlapping changes apart and auto-merges them', () => {
    const chunks = merge3(base, L('{\n  "a": 2,\n  "t": 10,\n  "z": 0\n}'), theirs);
    expect(chunks.filter((c) => c.kind === 'change').map((c) => c.kind === 'change' && [c.from, c.conflict])).toEqual([
      ['mine', false],
      ['theirs', false],
    ]);
    const res = autoResolve(chunks, chunks.map(initialResolution));
    expect(mergedText(chunks, res)).toBe('{\n  "a": 2,\n  "t": 30,\n  "z": 0\n}');
  });

  it('marks overlapping changes of both sides as a conflict', () => {
    const chunks = merge3(base, mine, L('{\n  "a": 1,\n  "k": "other",\n  "t": 10,\n  "z": 0\n}'));
    const conflicts = chunks.filter((c) => c.kind === 'change' && c.conflict);
    expect(conflicts).toHaveLength(1);
    // Nothing is merged until the conflict is decided.
    const res = autoResolve(chunks, chunks.map(initialResolution));
    expect(mergedText(chunks, res)).toBeNull();
  });

  it('builds the result from the sides taken', () => {
    const chunks = merge3(L('x\nv=1\ny'), L('x\nv=2\ny'), L('x\nv=3\ny'));
    const i = chunks.findIndex((c) => c.kind === 'change');
    const c = chunks[i];
    expect(resolvedLines(c, { mine: 'taken', theirs: 'rejected' })).toEqual(['v=2']);
    expect(resolvedLines(c, { mine: 'taken', theirs: 'taken' })).toEqual(['v=2', 'v=3']);
    expect(resolvedLines(c, { mine: 'rejected', theirs: 'rejected' })).toEqual(['v=1']);
    expect(resolvedLines(c, { mine: 'pending', theirs: 'taken' })).toBeNull();
  });

  it('keeps an insertion next to a replaced line apart', () => {
    const chunks = merge3(base, mine, theirs);
    expect(chunks.filter((c) => c.kind === 'change' && c.conflict)).toHaveLength(0);
    const res = autoResolve(chunks, chunks.map(initialResolution));
    expect(mergedText(chunks, res)).toBe('{\n  "a": 1,\n  "k": "uuid",\n  "t": 30,\n  "z": 0\n}');
  });

  it('treats the same change on both sides as no conflict', () => {
    const chunks = merge3(L('a\nb'), L('a\nB'), L('a\nB'));
    const res = autoResolve(chunks, chunks.map(initialResolution));
    expect(mergedText(chunks, res)).toBe('a\nB');
  });
});
