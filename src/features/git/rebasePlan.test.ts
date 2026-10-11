import { describe, it, expect } from 'vitest';
import type { RebaseVerb } from '$shared/model';
import { foldTarget, messageOf, needsMessage, rebasePlanError, toActions } from './rebasePlan';

const s = (short: string, action: RebaseVerb, full = `${short}\n\nwhy ${short}`, message: string | null = null) => ({
  hash: short.repeat(4),
  short,
  action,
  full,
  message,
});

describe('rebase plan', () => {
  it('folds a fixup into the nearest kept commit above it', () => {
    const steps = [s('a', 'edit'), s('b', 'drop'), s('c', 'squash'), s('d', 'fixup')];
    expect(foldTarget(steps, 3)?.short).toBe('a');
    expect(foldTarget(steps, 0)).toBeUndefined();
  });

  it('rejects a plan that starts with a fold or ends a commit with no message', () => {
    expect(rebasePlanError([s('a', 'drop'), s('b', 'fixup')])).toBe('git.rb.errFirst');
    expect(rebasePlanError([s('a', 'reword', 'a', ' ')])).toBe('git.rb.errMessage');
    expect(rebasePlanError([s('a', 'pick', 'a', ' '), s('b', 'squash')])).toBe('git.rb.errMessage');
    expect(rebasePlanError([s('a', 'pick'), s('b', 'squash')])).toBe('');
  });

  it('rewords with the whole message, body included', () => {
    const steps = [s('a', 'reword')];
    expect(messageOf(steps, 0)).toBe('a\n\nwhy a');
    expect(toActions([s('a', 'reword', 'a', 'a2\n\nbody\n')])).toEqual([
      { hash: 'aaaa', action: 'reword', message: 'a2\n\nbody' },
    ]);
  });

  it('gives a squash group the joined messages, fixups and drops left out, until edited', () => {
    const steps = [s('a', 'pick'), s('b', 'squash'), s('x', 'drop'), s('c', 'fixup'), s('d', 'squash'), s('e', 'pick')];
    expect(needsMessage(steps, 0)).toBe(true);
    expect(needsMessage(steps, 5)).toBe(false);
    expect(messageOf(steps, 0)).toBe('a\n\nwhy a\n\nb\n\nwhy b\n\nd\n\nwhy d');
    const acts = toActions(steps);
    expect(acts[0].message).toBe('a\n\nwhy a\n\nb\n\nwhy b\n\nd\n\nwhy d');
    expect(acts.slice(1).every((x) => x.message === undefined)).toBe(true);
    steps[0] = s('a', 'pick', 'a', 'all in one');
    expect(toActions(steps)[0].message).toBe('all in one');
  });

  it('sends no message for a plain pick or edit', () => {
    expect(toActions([s('a', 'pick'), s('b', 'edit'), s('c', 'fixup')])).toEqual([
      { hash: 'aaaa', action: 'pick' },
      { hash: 'bbbb', action: 'edit' },
      { hash: 'cccc', action: 'fixup' },
    ]);
  });
});
