import { describe, expect, it } from 'vitest';
import { buildWorkspaceExport } from './workspaceExport';

describe('buildWorkspaceExport', () => {
  const envs = [{ id: 'e', name: 'dev', vars: [{ key: 'T', value: 's3', enabled: true, secret: true }, { key: 'U', value: 'u', enabled: true }] }];
  it('strips secrets by default', () => {
    const out = JSON.parse(buildWorkspaceExport('w', [], [], envs, false));
    expect(out.environments[0].vars.map((v: { value: string }) => v.value)).toEqual(['', 'u']);
  });
  it('keeps secrets when asked', () => {
    const out = JSON.parse(buildWorkspaceExport('w', [], [], envs, true));
    expect(out.environments[0].vars[0].value).toBe('s3');
  });
});
