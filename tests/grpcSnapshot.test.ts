import { describe, expect, it } from 'vitest';
import { grpcSnapshot } from '../src/lib/stores';
import type { GrpcTabState } from '../src/lib/domain/types';

describe('grpcSnapshot', () => {
  it('returns undefined for an undefined snapshot', () => {
    expect(grpcSnapshot(undefined)).toBeUndefined();
  });

  it('drops runtime-only connectionId and tree', () => {
    const grpc: GrpcTabState = {
      endpoint: 'localhost:50051',
      plaintext: true,
      connectionId: 'conn-123',
      tree: { services: [] },
      method: 'pkg.Svc.Method',
      message: '{}',
      metadata: { authorization: 'Bearer x' },
    };
    const out = grpcSnapshot(grpc);
    expect(out).toEqual({
      endpoint: 'localhost:50051',
      plaintext: true,
      method: 'pkg.Svc.Method',
      message: '{}',
      metadata: { authorization: 'Bearer x' },
    });
    expect(out).not.toHaveProperty('connectionId');
    expect(out).not.toHaveProperty('tree');
  });

  it('deep-copies metadata so the persisted snapshot is detached from the tab', () => {
    const grpc: GrpcTabState = {
      endpoint: 'localhost:50051',
      plaintext: true,
      message: '{}',
      metadata: { k: 'v' },
    };
    const out = grpcSnapshot(grpc);
    expect(out?.metadata).not.toBe(grpc.metadata);
    out!.metadata.k = 'mutated';
    expect(grpc.metadata.k).toBe('v');
  });
});
