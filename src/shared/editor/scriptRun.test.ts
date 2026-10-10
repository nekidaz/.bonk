import { describe, expect, it } from 'vitest';
import { clockMs, consoleRows, testAt } from './scriptRun';
import type { ScriptEvent } from '$shared/model';

describe('consoleRows', () => {
  it('keeps the order and folds each stage’s tests into one summary at its last test', () => {
    const events: ScriptEvent[] = [
      { t: 1, stage: 'pre', kind: 'log', text: 'ts 1' },
      { t: 2, stage: 'send', kind: 'send', text: 'GET u', status: '200', ms: 5 },
      { t: 3, stage: 'post', kind: 'test', name: 'a', passed: true },
      { t: 4, stage: 'post', kind: 'env', op: 'set', key: 'id', value: '7' },
      { t: 5, stage: 'post', kind: 'test', name: 'b', passed: false },
    ];
    expect(consoleRows(events).map((r) => `${r.stage}:${r.kind}`)).toEqual([
      'pre:log',
      'send:send',
      'post:env',
      'post:test',
    ]);
    expect(consoleRows(events)[3]).toEqual({ t: 5, stage: 'post', kind: 'test', total: 2, failed: 1 });
  });
});

describe('testAt', () => {
  const tests = [
    { name: 'a', passed: true, line: 3 },
    { name: 'b', passed: false, line: 9 },
  ];
  it('matches by line, then by name', () => {
    expect(testAt(tests, 9)?.name).toBe('b');
    expect(testAt(tests, 4, 'a')?.line).toBe(3);
    expect(testAt(tests, 4)).toBeUndefined();
  });
});

describe('clockMs', () => {
  it('pads to HH:MM:SS.mmm', () => {
    expect(clockMs(Date.UTC(2026, 0, 1, 2, 4, 31, 8))).toBe('02:04:31.008');
  });
});
