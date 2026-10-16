import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
import { presentEditorError, presentGrpcError } from './grpcError';

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

describe('presentEditorError', () => {
  const tr = (key: string) => key;
  it('schema guidance wins over everything', () => {
    expect(presentEditorError({ message: 'Pre-request script failed' }, true, tr)).toMatchObject({
      kind: 'schema',
      message: 'Pre-request script failed',
      icon: 'description',
    });
  });
  it('classifies script, validation and unknown errors', () => {
    const present = (message: string, code?: string) => presentEditorError({ message, code }, false, tr);
    expect(present('Pre-request script failed')).toMatchObject({ kind: 'script', raw: 'Pre-request script failed' });
    expect(present('Select a method first').kind).toBe('validation');
    expect(present('Выберите метод').kind).toBe('validation');
    expect(present('invalid endpoint x', 'INVALID_ARGUMENT')).toMatchObject({
      kind: 'unknown',
      raw: 'invalid endpoint x',
    });
  });
});
