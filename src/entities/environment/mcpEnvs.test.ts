import { describe, expect, it } from 'vitest';
import {
  allowedEnvNames,
  autoAllowNewEnv,
  isProdLike,
  renameEnvAllowance,
  scopeOf,
  setAllEnvs,
  toggleEnv,
} from './mcpEnvs';

const envs = [
  { name: 'Dev' },
  { name: 'Staging' },
  { name: 'Production' },
  { name: 'Live EU' },
  { name: 'Safe', protected: true },
];
const base = { environments: null as string[] | null };

describe('mcpEnvs', () => {
  it('detects production-like', () => {
    expect(envs.map(isProdLike)).toEqual([false, false, true, true, true]);
  });
  it('legacy prefs derive the scope', () => {
    expect(scopeOf(base)).toBe('all-but-prod');
    expect(scopeOf({ environments: ['Dev'] })).toBe('selected');
  });
  it('all-but-prod excludes prod-like', () => {
    expect([...allowedEnvNames(base, envs)]).toEqual(['Dev', 'Staging']);
  });
  it('toggle from all-but-prod becomes selected', () => {
    const n = toggleEnv(base, envs, 'Dev');
    expect(n).toEqual({ envScope: 'selected', environments: ['Staging'] });
    expect([...allowedEnvNames(n, envs)]).toEqual(['Staging']);
    expect(toggleEnv(n, envs, 'Production').environments).toEqual(['Staging', 'Production']);
  });
  it('bulk all / none', () => {
    expect(setAllEnvs(envs, true).environments).toHaveLength(5);
    expect(setAllEnvs(envs, false).environments).toEqual([]);
  });
  it('drops names that no longer exist', () => {
    expect([...allowedEnvNames({ environments: ['Dev', 'Gone'] }, envs)]).toEqual(['Dev']);
  });
  it('auto-allow adds new non-prod envs only when enabled and selected', () => {
    const p = { envScope: 'selected' as const, environments: ['Dev'], autoAllowNew: true };
    expect(autoAllowNewEnv(p, { name: 'QA' }).environments).toEqual(['Dev', 'QA']);
    expect(autoAllowNewEnv(p, { name: 'Production 2' })).toBe(p);
    expect(autoAllowNewEnv({ ...p, autoAllowNew: false }, { name: 'QA' }).environments).toEqual(['Dev']);
    expect(autoAllowNewEnv(base, { name: 'QA' })).toBe(base);
  });
  it('rename carries the allowance, never into prod-like', () => {
    const p = { envScope: 'selected' as const, environments: ['New environment', 'Dev'] };
    expect(renameEnvAllowance(p, 'New environment', { name: 'QA' }).environments).toEqual(['Dev', 'QA']);
    expect(renameEnvAllowance(p, 'New environment', { name: 'Prod' }).environments).toEqual(['Dev']);
  });
});
