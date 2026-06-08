import { describe, it, expect } from 'vitest';
import { methodShort } from '../src/lib/domain/grpc';

describe('methodShort', () => {
  it('takes last dotted segment', () => {
    expect(methodShort('grpcbin.GRPCBin.DummyUnary')).toBe('DummyUnary');
  });
  it('returns input when no dot', () => {
    expect(methodShort('Foo')).toBe('Foo');
  });
});
