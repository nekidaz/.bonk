import { describe, expect, it } from 'vitest';
import { presentGrpcError } from './grpcError';

describe('presentGrpcError', () => {
  it('extracts a tonic status and keeps the human message', () => {
    const view = presentGrpcError(
      'ERROR',
      'grpc status Unauthenticated: The request does not have valid authentication credentials: authorization token is not provided',
    );
    expect(view.code).toBe('UNAUTHENTICATED');
    expect(view.title).toBe('Authentication required');
    expect(view.message).toBe(
      'The request does not have valid authentication credentials: authorization token is not provided',
    );
    expect(view.hint).toContain('Metadata');
    expect(view.action).toBe('metadata');
  });

  it('infers authentication errors when the transport omitted the status code', () => {
    const view = presentGrpcError('ERROR', 'grpc status authorization token is not provided');
    expect(view.code).toBe('UNAUTHENTICATED');
    expect(view.message).toBe('authorization token is not provided');
  });

  it('uses the result status for cancellations', () => {
    const view = presentGrpcError('CANCELLED', 'Request cancelled');
    expect(view.code).toBe('CANCELLED');
    expect(view.title).toBe('Request cancelled');
  });

  it('falls back cleanly for an unknown failure', () => {
    const view = presentGrpcError('ERROR', 'something unexpected happened');
    expect(view.code).toBe('UNKNOWN');
    expect(view.message).toBe('something unexpected happened');
  });
});
