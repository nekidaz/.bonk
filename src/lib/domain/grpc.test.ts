import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
import {
  grpcAuthMetadata,
  isRetryableDialError,
  dialFailureReason,
  stripsAuthorization,
  outgoingGrpcMetadata,
  grpcCodeTone,
  grpcMethodKind,
  grpcNoServicesHint,
  grpcConnectFailureMessage,
  inferGrpcPlaintext,
  methodShort,
  parseGrpcurl,
  checkGrpcMessage,
  atTopLevelKey,
  grpcFieldStub,
  isGrpcConnectionError,
} from './grpc';
import type { GrpcField } from './types';

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

  it('honours an explicit scheme on any port', () => {
    expect(inferGrpcPlaintext('https://partner-program:9090')).toBe(false);
    expect(inferGrpcPlaintext('http://api.example.com:443')).toBe(true);
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
    expect(grpcConnectFailureMessage('reflection', 'schema', err)).toBe(grpcNoServicesHint());
    // The default (unset) source loads via reflection too.
    expect(grpcConnectFailureMessage(undefined, 'schema', err)).toBe(grpcNoServicesHint());
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
    expect(grpcConnectFailureMessage('reflection', 'dial', 'connect failed: refused')).toBe('connect failed: refused');
  });
});

describe('methodShort', () => {
  it('returns the trailing segment of a fully-qualified symbol', () => {
    expect(methodShort('pkg.Service.GetActions')).toBe('GetActions');
    expect(methodShort('GetActions')).toBe('GetActions');
  });
});

describe('plaintext authorization guard', () => {
  it('strips authorization over plaintext unless the request opts in', () => {
    expect(stripsAuthorization({}, true)).toBe(true);
    expect(stripsAuthorization({ keepAuthOnPlaintext: true }, true)).toBe(false);
    expect(stripsAuthorization({}, false)).toBe(false);
    expect(outgoingGrpcMetadata({ Authorization: 'x', 'x-id': '1' }, true)).toEqual({ 'x-id': '1' });
  });
  it('tones and kinds', () => {
    expect([grpcCodeTone('INVALID_ARGUMENT'), grpcCodeTone('INTERNAL')]).toEqual(['warning', 'danger']);
    expect(grpcMethodKind({ serverStreaming: true })).toBe('server stream');
  });
});

describe('dial retry helpers', () => {
  it('retries only failures that never reached the server', () => {
    expect(isRetryableDialError('connect failed: tcp connect error: Connection refused (os error 61)')).toBe(true);
    expect(isRetryableDialError('invalid endpoint http://{{host}}: invalid uri')).toBe(false);
    expect(dialFailureReason('connect failed: tcp connect error: Connection refused (os error 61)')).toBe(
      'connection refused',
    );
  });
});

describe('grpcAuthMetadata', () => {
  it('maps auth configs to metadata', () => {
    const r = (v: string) => v.replace('{{t}}', 'tok');
    expect(grpcAuthMetadata({ type: 'bearer', bearerToken: '{{t}}' }, r)).toEqual({ authorization: 'Bearer tok' });
    expect(grpcAuthMetadata({ type: 'basic', basicUsername: 'a', basicPassword: 'b' }, r)).toEqual({
      authorization: 'Basic YTpi',
    });
    expect(grpcAuthMetadata({ type: 'apiKey', apiKeyName: 'X-Key', apiKeyValue: '1' }, r)).toEqual({ 'x-key': '1' });
    expect(grpcAuthMetadata({ type: 'none' }, r)).toEqual({});
  });
});

describe('parseGrpcurl', () => {
  it('takes endpoint, method, message and headers from a pasted command', () => {
    const cmd = `grpcurl -plaintext \\\n  -H 'Authorization: Bearer {{token}}' \\\n  -d '{"name":"Aru"}' localhost:50051 helloworld.Greeter/SayHello`;
    expect(parseGrpcurl(cmd)).toEqual({
      endpoint: 'localhost:50051',
      plaintext: true,
      method: 'helloworld.Greeter.SayHello',
      message: '{\n  "name": "Aru"\n}',
      metadata: { authorization: 'Bearer {{token}}' },
      insecure: false,
      protoPaths: [],
      importPaths: [],
    });
  });

  it('reads -proto/-import-path/-insecure and -flag=value, skipping other value flags', () => {
    const r = parseGrpcurl(
      'grpcurl -insecure -import-path=./protos -proto echo.proto -max-time 5 api:443 bonk.Echo/Ping',
    );
    expect(r).toMatchObject({
      endpoint: 'api:443',
      method: 'bonk.Echo.Ping',
      insecure: true,
      plaintext: false,
      protoPaths: ['echo.proto'],
      importPaths: ['./protos'],
    });
  });

  it('ignores anything that is not grpcurl', () => {
    expect(parseGrpcurl('curl https://x')).toBeUndefined();
    expect(parseGrpcurl('localhost:50051')).toBeUndefined();
  });
});

const FIELDS: GrpcField[] = [
  { name: 'name', protoName: 'name', typeLabel: 'string', json: 'string' },
  {
    name: 'greetingType',
    protoName: 'greeting_type',
    typeLabel: 'enum Greeting',
    json: 'enum',
    enumValues: ['FORMAL', 'CASUAL'],
  },
  { name: 'count', protoName: 'count', typeLabel: 'int64', json: 'number' },
  { name: 'tags', protoName: 'tags', typeLabel: 'repeated string', json: 'array' },
];

describe('checkGrpcMessage', () => {
  it('flags unknown keys and wrong JSON types, accepting proto names and {{vars}}', () => {
    const msg =
      '{"name": 1, "greeting_type": "LOUD", "count": "9007199254740993", "tags": "a", "extra": true, "nick": null}';
    expect(checkGrpcMessage(msg, FIELDS)).toEqual([
      { field: 'name', kind: 'type', expected: 'string' },
      { field: 'greeting_type', kind: 'type', expected: 'enum Greeting' },
      { field: 'tags', kind: 'type', expected: 'repeated string' },
      { field: 'extra', kind: 'unknown' },
      { field: 'nick', kind: 'unknown' },
    ]);
    expect(checkGrpcMessage('{"name": "Aru", "count": "{{n}}", "greetingType": 1}', FIELDS)).toEqual([]);
  });

  it('stays quiet without a schema or on invalid JSON', () => {
    expect(checkGrpcMessage('{"x": 1}', undefined)).toEqual([]);
    expect(checkGrpcMessage('{"x": ', FIELDS)).toEqual([]);
  });
});

describe('atTopLevelKey', () => {
  it('is true after the root brace or a comma at depth 1', () => {
    expect(atTopLevelKey('{\n  ')).toBe(true);
    expect(atTopLevelKey('{\n  "name": "Aru",\n  "lo')).toBe(true);
  });
  it('is false in values, nested objects and strings', () => {
    expect(atTopLevelKey('{\n  "name": ')).toBe(false);
    expect(atTopLevelKey('{ "a": { ')).toBe(false);
    expect(atTopLevelKey('{ "a": "x, ')).toBe(false);
    expect(atTopLevelKey('')).toBe(false);
  });
});

describe('grpcFieldStub', () => {
  it('inserts a value of the field type', () => {
    expect(FIELDS.map(grpcFieldStub)).toEqual(['""', '"FORMAL"', '0', '[]']);
  });
});

describe('isGrpcConnectionError', () => {
  it('flags dial and transport failures', () => {
    expect(isGrpcConnectionError('transport error: connection refused')).toBe(true);
    expect(isGrpcConnectionError('dns error: failed to lookup address')).toBe(true);
  });

  it('leaves schema hints, request errors and empty text alone', () => {
    expect(isGrpcConnectionError(grpcNoServicesHint())).toBe(false);
    expect(isGrpcConnectionError('Select a method first')).toBe(false);
    expect(isGrpcConnectionError('')).toBe(false);
  });
});
