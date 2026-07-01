import { describe, expect, it } from 'vitest';
import {
  GRPC_NO_SERVICES_HINT,
  grpcConnectFailureMessage,
  inferGrpcPlaintext,
  methodShort,
} from './grpc';

describe('inferGrpcPlaintext', () => {
  it('is plaintext for non-TLS ports', () => {
    expect(inferGrpcPlaintext('localhost:9090')).toBe(true);
    expect(inferGrpcPlaintext('grpc.example.com:50051')).toBe(true);
  });

  it('is TLS for :443, including when the port came from a resolved {{var}}', () => {
    expect(inferGrpcPlaintext('api.example.com:443')).toBe(false);
    // e.g. endpoint template "{{host}}" with host = "api.example.com:443",
    // resolved BEFORE inference — the raw template has no ":443" to see.
    expect(inferGrpcPlaintext('{{host}}'.replace('{{host}}', 'api.example.com:443'))).toBe(false);
  });

  it('does not match :443 embedded in a longer port', () => {
    expect(inferGrpcPlaintext('localhost:4433')).toBe(true);
  });
});

describe('grpcConnectFailureMessage', () => {
  it('shows the real error for dial-stage failures regardless of source', () => {
    const err = new Error('invalid endpoint http://{{host}}:9090: invalid uri character');
    expect(grpcConnectFailureMessage('reflection', 'dial', err)).toBe(err.message);
    expect(grpcConnectFailureMessage(undefined, 'dial', err)).toBe(err.message);
    expect(grpcConnectFailureMessage('proto', 'dial', err)).toBe(err.message);
  });

  it('maps schema-stage failures to the no-services hint for reflection sources', () => {
    const err = new Error('reflection unimplemented');
    expect(grpcConnectFailureMessage('reflection', 'schema', err)).toBe(GRPC_NO_SERVICES_HINT);
    // The default (unset) source loads via reflection too.
    expect(grpcConnectFailureMessage(undefined, 'schema', err)).toBe(GRPC_NO_SERVICES_HINT);
  });

  it('keeps verbatim errors for the proto source at every stage', () => {
    expect(grpcConnectFailureMessage('proto', 'schema', new Error('compile failed: x.proto'))).toBe(
      'compile failed: x.proto',
    );
    expect(grpcConnectFailureMessage('proto', 'schema', 'Select a .proto file first.')).toBe(
      'Select a .proto file first.',
    );
  });

  it('stringifies non-Error throwables', () => {
    expect(grpcConnectFailureMessage('reflection', 'dial', 'connect failed: refused')).toBe(
      'connect failed: refused',
    );
  });
});

describe('methodShort', () => {
  it('returns the trailing segment of a fully-qualified symbol', () => {
    expect(methodShort('pkg.Service.GetActions')).toBe('GetActions');
    expect(methodShort('GetActions')).toBe('GetActions');
  });
});
