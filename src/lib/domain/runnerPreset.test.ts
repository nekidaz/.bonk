import { describe, expect, it } from 'vitest';
import { isPreset, upsertPreset, type RunnerPreset } from './runnerPreset';

const p = (name: string, iterations = 1): RunnerPreset => ({
  name,
  folderIds: [],
  excludedIds: [],
  orderIds: [],
  iterations,
  delayMs: 0,
  stopOnFailure: false,
  saveResponses: true,
  envId: null,
});

describe('runner presets', () => {
  it('upsert replaces by name and bounds the list', () => {
    const l = upsertPreset(upsertPreset([], p('a')), p('b'));
    expect(upsertPreset(l, p('a', 5)).map((x) => [x.name, x.iterations])).toEqual([
      ['b', 1],
      ['a', 5],
    ]);
    expect(upsertPreset(l, p('c'), 2).map((x) => x.name)).toEqual(['b', 'c']);
  });
  it('guards persisted shape', () => {
    expect(isPreset(p('a'))).toBe(true);
    expect(isPreset({ name: 'a' })).toBe(false);
    expect(isPreset(null)).toBe(false);
  });
});
