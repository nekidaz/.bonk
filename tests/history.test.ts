import { describe, it, expect } from 'vitest';
import { pushCapped } from '../src/lib/domain/history';

describe('pushCapped', () => {
  it('prepends newest and caps length', () => {
    const out = pushCapped([1, 2, 3], 0, 3);
    expect(out).toEqual([0, 1, 2]);
  });
  it('keeps all when under cap', () => {
    expect(pushCapped([1], 2, 5)).toEqual([2, 1]);
  });
});
