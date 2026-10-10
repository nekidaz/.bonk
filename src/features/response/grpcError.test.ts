import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
import { presentGrpcError } from './grpcError';

describe('presentGrpcError', () => {
  it('presents the status code and keeps the human message', () => {
    const view = presentGrpcError('Unauthenticated', 'authorization token is not provided');
    expect(view.code).toBe('UNAUTHENTICATED');
    expect(view.title).toBe('Требуется аутентификация');
    expect(view.message).toBe('authorization token is not provided');
    expect(view.hint).toContain('Metadata');
    expect(view.action).toBe('metadata');
  });

  it('does not guess a code from the message text', () => {
    expect(presentGrpcError('ERROR', 'connection refused: deadline exceeded').code).toBe('UNKNOWN');
  });

  it('uses the result status for cancellations', () => {
    const view = presentGrpcError('CANCELLED', 'Request cancelled');
    expect(view.code).toBe('CANCELLED');
    expect(view.title).toBe('Запрос отменён');
  });

  it('falls back cleanly for an unknown failure', () => {
    const view = presentGrpcError('ERROR', 'something unexpected happened');
    expect(view.code).toBe('UNKNOWN');
    expect(view.message).toBe('something unexpected happened');
  });
});
