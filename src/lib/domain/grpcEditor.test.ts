import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
import {
  applyGrpcurlImport,
  certExpiry,
  fieldCompletionOptions,
  fileName,
  invokeFailureResult,
  omitKey,
  presentEditorError,
  resolveOutgoingGrpc,
  sentEntries,
  splitMethodSymbol,
  withGrpcEndpoint,
} from './grpcEditor';
import type { GrpcField, Tab } from './types';

const grpcTab = (grpc: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({
    id: 't1',
    title: 'old',
    grpc: { endpoint: 'a:1', message: '{}', metadata: { k: 'v' }, connectionId: 'c', tree: { services: [] }, ...grpc },
    ...extra,
  }) as unknown as Tab;

describe('omitKey', () => {
  it('drops the key, and returns the same object when absent', () => {
    expect(omitKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
    const m = { a: 1 };
    expect(omitKey(m, 'zz')).toBe(m);
  });
});

describe('invokeFailureResult', () => {
  it('maps a cancellation to CANCELLED and everything else to ERROR', () => {
    expect(invokeFailureResult(new Error('request Cancelled by user'))).toMatchObject({
      ok: false,
      status: 'CANCELLED',
      body: 'Request cancelled',
    });
    expect(invokeFailureResult('boom')).toMatchObject({
      ok: false,
      status: 'ERROR',
      body: 'boom',
      elapsed_ms: 0,
      size_bytes: 0,
    });
  });
});

describe('withGrpcEndpoint', () => {
  it('retitles and drops the connection', () => {
    const t = withGrpcEndpoint(grpcTab(), 'b:2', 'b:2 title');
    expect(t.title).toBe('b:2 title');
    expect(t.grpc).toMatchObject({ endpoint: 'b:2', connectionId: undefined, tree: undefined, message: '{}' });
  });
  it('keeps a hand-made title and ignores non-gRPC tabs', () => {
    expect(withGrpcEndpoint(grpcTab({}, { manualTitle: true }), 'b:2', 'x').title).toBe('old');
    const http = { id: 'h', title: 'h' } as unknown as Tab;
    expect(withGrpcEndpoint(http, 'b:2', 'x')).toBe(http);
  });
});

describe('applyGrpcurlImport', () => {
  const cmd = {
    endpoint: 'h:9',
    plaintext: true,
    method: 'p.S.M',
    message: '{"a":1}',
    metadata: { x: '1' },
    insecure: true,
    protoPaths: ['/abs/a.proto', 'rel.proto'],
    importPaths: ['/inc', 'rel'],
  };
  it('fills the request, merges metadata and keeps only absolute proto paths', () => {
    const t = applyGrpcurlImport(grpcTab(), cmd, 'h:9');
    expect(t.title).toBe('h:9');
    expect(t.grpc).toMatchObject({
      endpoint: 'h:9',
      plaintext: true,
      method: 'p.S.M',
      message: '{"a":1}',
      metadata: { k: 'v', x: '1' },
      tls: { insecure: true },
      source: 'proto',
      protoPaths: ['/abs/a.proto'],
      importPaths: ['/inc'],
      connectionId: undefined,
      tree: undefined,
    });
  });
  it('leaves method/message/source alone when the command has none', () => {
    const t = applyGrpcurlImport(
      grpcTab({ method: 'keep', message: 'keep' }),
      { ...cmd, method: undefined, message: undefined, insecure: false, protoPaths: [], importPaths: [] },
      't',
    );
    expect(t.grpc).toMatchObject({ method: 'keep', message: 'keep' });
    expect(t.grpc && 'source' in t.grpc && t.grpc.source).toBeFalsy();
  });
});

describe('resolveOutgoingGrpc', () => {
  const bearer = { type: 'bearer', bearerToken: '{{tok}}', apiKeyIn: 'header' } as never;
  it('resolves vars, lets explicit metadata win over auth and defaults an empty message to {}', () => {
    const out = resolveOutgoingGrpc(
      bearer,
      '  ',
      { authorization: 'Custom {{tok}}', x: '{{tok}}' },
      [],
      undefined,
      { tok: 'T' },
      false,
    );
    expect(out).toEqual({ message: '{}', metadata: { authorization: 'Custom T', x: 'T' } });
    expect(resolveOutgoingGrpc(bearer, '{"a":"{{tok}}"}', {}, [], undefined, { tok: 'T' }, false).message).toBe(
      '{"a":"T"}',
    );
    expect(resolveOutgoingGrpc(bearer, '{}', {}, [], undefined, { tok: 'T' }, false).metadata).toEqual({
      authorization: 'Bearer T',
    });
  });
  it('strips authorization when asked', () => {
    const out = resolveOutgoingGrpc(bearer, '{}', { x: '1' }, [], undefined, { tok: 'T' }, true);
    expect(out.metadata).toEqual({ x: '1' });
  });
});

const tr = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('presentEditorError', () => {
  it('schema guidance wins over everything', () => {
    expect(presentEditorError('anything', true, '', tr)).toMatchObject({
      kind: 'schema',
      message: 'anything',
      icon: 'description',
    });
  });
  it('falls back to the server name when the endpoint is blank', () => {
    const p = presentEditorError('connection refused', false, '  ', tr);
    expect(p.kind).toBe('connection');
    expect(p.message).toBe('grpc.err.connMsg:{"target":"grpc.err.theServer"}');
  });
  it('classifies script, validation and unknown errors', () => {
    expect(presentEditorError('Pre-request script failed', false, 'h:1', tr).kind).toBe('script');
    expect(presentEditorError('Select a method first', false, 'h:1', tr).kind).toBe('validation');
    expect(presentEditorError('Выберите метод', false, 'h:1', tr).kind).toBe('validation');
    expect(presentEditorError('boom', false, 'h:1', tr)).toMatchObject({ kind: 'unknown', raw: 'boom' });
  });
});

describe('splitMethodSymbol', () => {
  it('splits at the last dot', () => {
    expect(splitMethodSymbol('pkg.Greeter.SayHello')).toEqual({ service: 'pkg.Greeter', name: 'SayHello' });
    expect(splitMethodSymbol('Bare')).toEqual({ service: '', name: 'Bare' });
    expect(splitMethodSymbol('')).toEqual({ service: '', name: '' });
  });
});

describe('sentEntries', () => {
  it('numbers one row per array element after the already-sent ones', () => {
    const rows = sentEntries('[{"a":1},{"b":2}]', 3, 99);
    expect(rows.map((r) => [r.index, r.body, r.atMs, r.sent])).toEqual([
      [4, '{"a":1}', 99, true],
      [5, '{"b":2}', 99, true],
    ]);
  });
  it('wraps a single object and ignores invalid JSON', () => {
    expect(sentEntries('{"a":1}', 0, 1)).toHaveLength(1);
    expect(sentEntries('{nope', 0)).toEqual([]);
  });
});

describe('fileName', () => {
  it('handles both separators', () => {
    expect(fileName('/a/b/c.proto')).toBe('c.proto');
    expect(fileName('C:\\a\\b.pem')).toBe('b.pem');
    expect(fileName('plain')).toBe('plain');
  });
});

describe('certExpiry', () => {
  const now = Date.UTC(2026, 0, 1);
  it('counts whole days and goes negative when expired', () => {
    expect(certExpiry(now / 1000 + 86_400 * 10 + 5, 'en', now).days).toBe(10);
    expect(certExpiry(now / 1000 - 86_400 * 2, 'en', now).days).toBe(-2);
  });
  it('formats the date per language without a trailing period', () => {
    expect(certExpiry(Date.UTC(2026, 5, 15, 12) / 1000, 'en', now).date).toMatch(/Jun/);
    expect(certExpiry(Date.UTC(2026, 5, 15, 12) / 1000, 'ru', now).date).not.toMatch(/г\.|\./);
  });
});

describe('fieldCompletionOptions', () => {
  const fields = [
    { name: 'userName', protoName: 'user_name', typeLabel: 'string', json: 'string' },
    { name: 'tags', protoName: 'tags', typeLabel: 'repeated string', json: 'array', doc: 'labels' },
  ] as GrpcField[];

  it('marks present fields, sinks them and ranks the rest by position', () => {
    const [a, b] = fieldCompletionOptions(fields, new Set(['userName']), 'Req', tr) as unknown as Array<
      Record<string, unknown>
    >;
    expect(a).toMatchObject({ label: 'user_name', set: true, boost: -99, doc: 'grpc.msg.fieldSet' });
    expect(b).toMatchObject({ label: 'tags', set: false, boost: 49, doc: 'labels' });
    expect(a.section).toEqual({ name: 'grpc.msg.fieldsHead:{"type":"Req"}' });
  });

  it('apply swallows surrounding quotes and parks the caret inside an empty stub', () => {
    const [opt] = fieldCompletionOptions(fields, new Set(), 'Req', tr);
    const dispatch = vi.fn();
    const doc = '{"us"}';
    const view = { state: { sliceDoc: (f: number, t: number) => doc.slice(f, t) }, dispatch };
    (opt.apply as (...a: unknown[]) => void)(view, opt, 2, 4);
    const { changes, selection } = dispatch.mock.calls[0][0];
    expect(changes).toEqual({ from: 1, to: 5, insert: '"user_name": ""' });
    expect(selection.anchor).toBe(1 + '"user_name": ""'.length - 1);
  });
});
