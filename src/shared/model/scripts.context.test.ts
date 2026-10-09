import { describe, it, expect } from 'vitest';
import { uiLanguage } from '$shared/i18n';
import {
  applyEnvPatch,
  applyGrpcRequestPatch,
  applyRequestPatch,
  buildGrpcScriptContext,
  buildScriptContext,
  parseScriptResult,
} from './scripts';
import type { GrpcResult, HttpRequest, HttpResponse, VarRow } from './types';

uiLanguage.current = 'en'; // these assertions check the English strings

function v(key: string, value: string, enabled = true): VarRow {
  return { key, value, enabled };
}

const req: HttpRequest = {
  method: 'POST',
  url: 'https://api.example.com/users',
  headers: { Authorization: 'Bearer x' },
  body: '{"a":1}',
};

const res: HttpResponse = {
  status: 201,
  headers: { 'content-type': 'application/json' },
  body: '{"id":7}',
  final_url: 'https://api.example.com/users',
  elapsed_ms: 34,
  size_bytes: 8,
};

describe('buildScriptContext', () => {
  it('maps request fields and leaves response null in the pre-request phase', () => {
    const ctx = buildScriptContext(req, undefined, { host: 'h' }, { base: 'b' });
    expect(ctx.request).toEqual({
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: { Authorization: 'Bearer x' },
      body: '{"a":1}',
    });
    expect(ctx.response).toBeNull();
    expect(ctx.environment).toEqual({ host: 'h' });
    expect(ctx.globals).toEqual({ base: 'b' });
  });

  it('maps the response (status→code, elapsed_ms→responseTime) in the test phase', () => {
    const ctx = buildScriptContext(req, res, {}, {});
    expect(ctx.response).toEqual({
      code: 201,
      responseTime: 34,
      headers: { 'content-type': 'application/json' },
      body: '{"id":7}',
    });
  });

  it('copies the header map so later mutation cannot leak back into the request', () => {
    const ctx = buildScriptContext(req, undefined, {}, {});
    ctx.request.headers['X-New'] = 'y';
    expect(req.headers).toEqual({ Authorization: 'Bearer x' });
  });
});

describe('applyRequestPatch', () => {
  it('returns the same request when the patch is null/undefined', () => {
    expect(applyRequestPatch(req, null)).toBe(req);
    expect(applyRequestPatch(req, undefined)).toBe(req);
  });

  it('overwrites url/body/headers without mutating the input', () => {
    const out = applyRequestPatch(req, {
      url: 'https://api.example.com/v2',
      body: '{"a":2}',
      headers: { Authorization: 'Bearer x', 'X-Trace': 'yes' },
    });
    expect(out.url).toBe('https://api.example.com/v2');
    expect(out.body).toBe('{"a":2}');
    expect(out.headers).toEqual({ Authorization: 'Bearer x', 'X-Trace': 'yes' });
    // input untouched
    expect(req.url).toBe('https://api.example.com/users');
    expect(req.headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('leaves fields absent from the patch untouched', () => {
    const out = applyRequestPatch(req, { url: 'https://x' });
    expect(out.body).toBe('{"a":1}');
    expect(out.headers).toEqual({ Authorization: 'Bearer x' });
  });
});

const grpcReq = {
  method: 'pkg.Svc.Method',
  endpoint: 'localhost:50051',
  message: '{"a":1}',
  metadata: { authorization: 'Bearer x' },
};

const grpcRes: GrpcResult = { ok: true, status: 'OK', body: '{"id":7}', elapsed_ms: 12, size_bytes: 8 };

describe('buildGrpcScriptContext', () => {
  it('maps endpoint→url, metadata→headers, message→body and leaves response null pre-call', () => {
    const ctx = buildGrpcScriptContext(grpcReq, undefined, { host: 'h' }, { base: 'b' });
    expect(ctx.request).toEqual({
      method: 'pkg.Svc.Method',
      url: 'localhost:50051',
      headers: { authorization: 'Bearer x' },
      body: '{"a":1}',
    });
    expect(ctx.response).toBeNull();
    expect(ctx.environment).toEqual({ host: 'h' });
    expect(ctx.globals).toEqual({ base: 'b' });
  });

  it('defaults method to GRPC when absent', () => {
    const ctx = buildGrpcScriptContext({ endpoint: 'x', message: '{}', metadata: {} }, undefined, {}, {});
    expect(ctx.request.method).toBe('GRPC');
  });

  it('maps an ok result to code 0 and a failed result to code 2', () => {
    const okCtx = buildGrpcScriptContext(grpcReq, grpcRes, {}, {});
    expect(okCtx.response).toEqual({ code: 0, responseTime: 12, headers: {}, body: '{"id":7}' });
    const failCtx = buildGrpcScriptContext(grpcReq, { ...grpcRes, ok: false, status: 'ERROR' }, {}, {});
    expect(failCtx.response?.code).toBe(2);
  });
});

describe('applyGrpcRequestPatch', () => {
  it('returns the same value when the patch is null/undefined', () => {
    expect(applyGrpcRequestPatch(grpcReq, null)).toBe(grpcReq);
    expect(applyGrpcRequestPatch(grpcReq, undefined)).toBe(grpcReq);
  });

  it('overwrites message/metadata without mutating the input', () => {
    const out = applyGrpcRequestPatch(grpcReq, { body: '{"a":2}', headers: { authorization: 'Bearer y' } });
    expect(out.message).toBe('{"a":2}');
    expect(out.metadata).toEqual({ authorization: 'Bearer y' });
    expect(grpcReq.message).toBe('{"a":1}');
  });

  it('maps a url patch onto endpoint too (callers may choose to ignore it)', () => {
    const out = applyGrpcRequestPatch(grpcReq, { url: 'localhost:9999' });
    expect(out.endpoint).toBe('localhost:9999');
    expect(out.message).toBe(grpcReq.message);
  });
});

describe('applyEnvPatch', () => {
  it('updates an existing key in place and keeps it enabled', () => {
    const rows = [v('token', 'old'), v('host', 'api')];
    expect(applyEnvPatch(rows, { token: 'new' }, [])).toEqual([v('token', 'new'), v('host', 'api')]);
  });

  it('re-enables a disabled row when the script sets it', () => {
    const rows = [v('token', 'old', false)];
    expect(applyEnvPatch(rows, { token: 'new' }, [])).toEqual([v('token', 'new')]);
  });

  it('appends a new enabled row for a key not present', () => {
    const rows = [v('host', 'api')];
    expect(applyEnvPatch(rows, { token: 'abc' }, [])).toEqual([v('host', 'api'), v('token', 'abc')]);
  });

  it('removes rows named in unset', () => {
    const rows = [v('a', '1'), v('b', '2'), v('c', '3')];
    expect(applyEnvPatch(rows, {}, ['b'])).toEqual([v('a', '1'), v('c', '3')]);
  });

  it('does not mutate the input list', () => {
    const rows = [v('a', '1')];
    applyEnvPatch(rows, { a: '2', b: '3' }, []);
    expect(rows).toEqual([v('a', '1')]);
  });
});

describe('parseScriptResult', () => {
  it('parses a full __out payload', () => {
    const raw = JSON.stringify({
      logs: ['hi', 42],
      tests: [
        { name: 'ok', passed: true },
        { name: 'bad', passed: false, error: 'boom' },
      ],
      envSet: { token: 'abc' },
      envUnset: ['stale'],
      globalsSet: { base: 'b' },
      globalsUnset: [],
      requestPatch: { url: 'https://new', headers: { 'X-A': '1' } },
      error: null,
    });
    const out = parseScriptResult(raw);
    // Non-string logs are dropped.
    expect(out.logs).toEqual(['hi']);
    expect(out.tests).toEqual([
      { name: 'ok', passed: true, error: undefined },
      { name: 'bad', passed: false, error: 'boom' },
    ]);
    expect(out.envSet).toEqual({ token: 'abc' });
    expect(out.envUnset).toEqual(['stale']);
    expect(out.globalsSet).toEqual({ base: 'b' });
    expect(out.requestPatch).toEqual({ url: 'https://new', body: undefined, headers: { 'X-A': '1' } });
    expect(out.error).toBeNull();
  });

  it('captures a script error string', () => {
    const out = parseScriptResult(JSON.stringify({ error: 'timed out' }));
    expect(out.error).toBe('timed out');
    expect(out.tests).toEqual([]);
  });

  it('returns an error result for invalid JSON instead of throwing', () => {
    const out = parseScriptResult('{ not json');
    expect(out.error).toContain('invalid output');
    expect(out.tests).toEqual([]);
    expect(out.requestPatch).toBeNull();
  });
});
