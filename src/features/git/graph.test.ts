import { describe, it, expect } from 'vitest';
import { commitDate, commitDateTime, firstParentChain, initials, joinSubjects, layoutGraph } from './graph';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0].segments).toEqual([{ from: 0, to: 0, half: 'bottom', color: 0 }]);
    // The root commit only receives a line from above.
    expect(rows[2].segments).toEqual([{ from: 0, to: 0, half: 'top', color: 0 }]);
  });

  it('opens a lane for a merged branch and closes it at the fork point', () => {
    // m merges f into main; f and b both come from a.
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    // The merge leaves toward both parents.
    expect(rows[0].segments).toContainEqual({ from: 0, to: 1, half: 'bottom', color: 1 });
    // f's first parent a: f keeps its lane while main passes through.
    expect(rows[1].segments).toContainEqual({ from: 0, to: 0, half: 'full', color: 0 });
    // At a, the side lane bends back into the node.
    expect(rows[3].segments).toContainEqual({ from: 1, to: 0, half: 'top', color: 1 });
    expect(Math.max(...rows.map((r) => r.width))).toBe(2);
  });

  it('gives an unmerged branch tip its own lane', () => {
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    expect(rows[1].color).not.toBe(rows[0].color);
  });
});

describe('graph labels', () => {
  it('makes avatar initials', () => {
    expect(initials('Дилмурат З.')).toBe('ДЗ');
    expect(initials('aru')).toBe('A');
  });

  it('says a shared subject prefix once', () => {
    expect(joinSubjects(['Webhooks: retry policy', 'Webhooks: signature check'])).toBe(
      'Webhooks: retry policy, signature check',
    );
    expect(joinSubjects(['Fix a', 'Add b'])).toBe('Fix a, Add b');
  });
});

describe('commit dates', () => {
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const ago = (s: number) => now / 1000 - s;
  it('says recent times relatively and older ones as a date', () => {
    expect(commitDate(ago(2 * 3600), now)).toBe('2 hr. ago');
    expect(commitDate(ago(26 * 3600), now)).toBe('yesterday');
    expect(commitDate(ago(30 * 86400), now)).toBe('Sep 11');
    expect(commitDateTime(ago(26 * 3600), now)).toBe('yesterday, 10:00 AM');
  });
});

describe('firstParentChain', () => {
  // main: m → b → a; a side branch: y → x → a, listed in between.
  const list = [c('m', 'b'), c('y', 'x'), c('b', 'a'), c('x', 'a'), c('a')];
  it('follows one branch past the rows of another', () => {
    expect(firstParentChain(list, 'x', 'y')).toEqual(['y', 'x']);
    expect(firstParentChain(list, 'm', 'a')).toEqual(['m', 'b', 'a']);
  });
  it('gives up when the commits are on different branches', () => {
    expect(firstParentChain(list, 'y', 'b')).toBeUndefined();
  });
});
