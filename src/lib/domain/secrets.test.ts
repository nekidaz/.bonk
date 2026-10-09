import { describe, expect, it } from 'vitest';
import { collectSecrets, mergeSecrets, stripSecrets } from './secrets';
import type { Environment, VarRow } from './types';

const g: VarRow[] = [
  { key: 'T', value: 'tok', enabled: true, secret: true },
  { key: 'P', value: 'p', enabled: true },
];
const envs: Environment[] = [
  {
    id: 'e1',
    name: 'Prod',
    vars: [
      { key: 'K', value: 'kk', enabled: true, secret: true },
      { key: 'E', value: '', enabled: true, secret: true },
    ],
  },
];

describe('secrets', () => {
  it('collects only non-empty secrets', () => {
    expect([...collectSecrets(g, envs)]).toEqual([
      ['globals:T', 'tok'],
      ['env:e1:K', 'kk'],
    ]);
  });
  it('strips only stored secrets', () => {
    const s = stripSecrets(g, envs, new Set(['env:e1:K']));
    expect(s.globals[0].value).toBe('tok');
    expect(s.envs[0].vars[0]).toEqual({ key: 'K', value: '', enabled: true, secret: true });
  });
  it('merge fills empty secrets, keeps legacy plain values', () => {
    const m = mergeSecrets(
      [{ ...g[0], value: '' }, g[1]],
      [{ ...envs[0], vars: [{ ...envs[0].vars[0], value: 'plain' }] }],
      new Map([
        ['globals:T', 'tok'],
        ['env:e1:K', 'kc'],
      ]),
    );
    expect(m.globals[0].value).toBe('tok');
    expect(m.envs[0].vars[0].value).toBe('plain');
  });
});
