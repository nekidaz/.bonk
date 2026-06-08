import { describe, it, expect } from 'vitest';
import { toWorkspaceRel, toAbs, grpcPathsToRel, grpcPathsToAbs } from './protoPaths';
import type { GrpcTabState } from './types';

describe('toWorkspaceRel / toAbs', () => {
  it('strips the workspace root prefix when inside it', () => {
    expect(toWorkspaceRel('/ws/proto/a.proto', '/ws')).toBe('proto/a.proto');
    expect(toWorkspaceRel('/ws/proto/a.proto', '/ws/')).toBe('proto/a.proto');
  });

  it('keeps absolute paths outside the root unchanged', () => {
    expect(toWorkspaceRel('/other/a.proto', '/ws')).toBe('/other/a.proto');
  });

  it('rejoins relative paths against the root', () => {
    expect(toAbs('proto/a.proto', '/ws')).toBe('/ws/proto/a.proto');
  });

  it('leaves already-absolute paths unchanged on toAbs', () => {
    expect(toAbs('/other/a.proto', '/ws')).toBe('/other/a.proto');
    expect(toAbs('C:\\x\\a.proto', '/ws')).toBe('C:\\x\\a.proto');
  });

  it('is a round-trip for in-root paths', () => {
    expect(toAbs(toWorkspaceRel('/ws/p/a.proto', '/ws'), '/ws')).toBe('/ws/p/a.proto');
  });
});

describe('grpcPathsToRel / grpcPathsToAbs', () => {
  const base: GrpcTabState = { endpoint: 'h:1', plaintext: true, message: '{}', metadata: {} };

  it('maps proto + import paths in both directions', () => {
    const abs: GrpcTabState = {
      ...base,
      source: 'proto',
      protoPaths: ['/ws/a.proto', '/out/b.proto'],
      importPaths: ['/ws/imports'],
    };
    const rel = grpcPathsToRel(abs, '/ws');
    expect(rel?.protoPaths).toEqual(['a.proto', '/out/b.proto']);
    expect(rel?.importPaths).toEqual(['imports']);
    const back = grpcPathsToAbs(rel, '/ws');
    expect(back?.protoPaths).toEqual(['/ws/a.proto', '/out/b.proto']);
    expect(back?.importPaths).toEqual(['/ws/imports']);
  });

  it('passes through reflection / undefined grpc untouched', () => {
    expect(grpcPathsToRel(undefined, '/ws')).toBeUndefined();
    expect(grpcPathsToRel(base, '/ws')).toEqual(base);
  });
});
