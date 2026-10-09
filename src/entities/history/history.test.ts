import { describe, expect, it } from 'vitest';
import { pruneByAge } from './history';

describe('pruneByAge', () => {
  const now = 100 * 86_400_000;
  const list = [{ at: now - 1 }, { at: now - 8 * 86_400_000 }];
  it('drops old entries', () => expect(pruneByAge(list, 7, now)).toEqual([list[0]]));
  it('0 keeps all', () => expect(pruneByAge(list, 0, now)).toBe(list));
});
