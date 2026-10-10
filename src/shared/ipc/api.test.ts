import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class {} }));
import { grpcConnect, grpcErrorCode, GrpcCommandError } from './api';

describe('gRPC command errors', () => {
  it("turns Rust's { code, message } into a GrpcCommandError", async () => {
    invoke.mockRejectedValueOnce({ code: 'UNAVAILABLE', message: 'connect failed: refused' });
    const e = await grpcConnect('h:1', true).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(GrpcCommandError);
    expect(grpcErrorCode(e)).toBe('UNAVAILABLE');
    expect((e as Error).message).toBe('connect failed: refused');
  });

  it('passes untyped string errors through unchanged', async () => {
    invoke.mockRejectedValueOnce('grpc state lock poisoned');
    const e = await grpcConnect('h:1', true).catch((err: unknown) => err);
    expect(e).toBe('grpc state lock poisoned');
    expect(grpcErrorCode(e)).toBeUndefined();
  });
});
