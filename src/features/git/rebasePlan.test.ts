import { describe, it, expect } from 'vitest';
import { foldTarget, rebasePlanError } from './rebasePlan';

const s = (short: string, action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop', message = 'm') => ({
  short,
  action,
  message,
});

describe('rebase plan', () => {
  it('folds a fixup into the nearest kept commit above it', () => {
    const steps = [s('a', 'pick'), s('b', 'drop'), s('c', 'squash'), s('d', 'fixup')];
    expect(foldTarget(steps, 3)?.short).toBe('a');
    expect(foldTarget(steps, 0)).toBeUndefined();
  });

  it('rejects a plan that starts with a fold or rewords to nothing', () => {
    expect(rebasePlanError([s('a', 'drop'), s('b', 'fixup')])).toBe('git.rb.errFirst');
    expect(rebasePlanError([s('a', 'reword', ' ')])).toBe('git.rb.errMessage');
    expect(rebasePlanError([s('a', 'pick'), s('b', 'squash')])).toBe('');
  });
});
