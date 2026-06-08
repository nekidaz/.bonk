import { describe, it, expect } from 'vitest';
import {
  currentBodyMode,
  currentRawFormat,
  setHeaderIfMissing,
  enabledBodyParams,
  buildUrlEncodedBody,
  buildMultipartBody,
  buildRequestForSend,
} from '../src/lib/domain/httpBody';
import type { BodyMode, BodyParam, RawBodyFormat, Tab } from '../src/lib/domain/types';

function bp(key: string, value: string, enabled = true): BodyParam {
  return { key, value, description: '', enabled };
}

function tab(overrides: Partial<Tab['request']> = {}): Tab {
  return {
    id: 't1',
    protocol: 'http',
    title: 'T',
    request: { method: 'POST', url: 'https://api.example.com', headers: {}, ...overrides },
  };
}

describe('currentBodyMode', () => {
  it('defaults to raw when unset or tab is undefined', () => {
    expect(currentBodyMode(undefined)).toBe('raw');
    expect(currentBodyMode(tab())).toBe('raw');
  });
  it('returns the explicit body mode', () => {
    const modes: BodyMode[] = ['none', 'form-data', 'urlencoded', 'raw', 'binary', 'graphql'];
    for (const m of modes) expect(currentBodyMode(tab({ bodyMode: m }))).toBe(m);
  });
});

describe('currentRawFormat', () => {
  it('returns the explicit rawBodyFormat when set', () => {
    const formats: RawBodyFormat[] = ['JSON', 'Text', 'JavaScript', 'HTML', 'XML'];
    for (const f of formats) expect(currentRawFormat(tab({ rawBodyFormat: f }))).toBe(f);
  });
  it('defaults to JSON for an empty/undefined body', () => {
    expect(currentRawFormat(undefined)).toBe('JSON');
    expect(currentRawFormat(tab({ body: '' }))).toBe('JSON');
    expect(currentRawFormat(tab({ body: '   ' }))).toBe('JSON');
  });
  it('sniffs JSON from a leading { or [', () => {
    expect(currentRawFormat(tab({ body: '{"a":1}' }))).toBe('JSON');
    expect(currentRawFormat(tab({ body: '  [1,2,3]' }))).toBe('JSON');
  });
  it('sniffs HTML and XML', () => {
    expect(currentRawFormat(tab({ body: '<!doctype html><html></html>' }))).toBe('HTML');
    expect(currentRawFormat(tab({ body: '<html><body></body></html>' }))).toBe('HTML');
    expect(currentRawFormat(tab({ body: '<?xml version="1.0"?><root/>' }))).toBe('XML');
  });
  it('falls back to Text for anything else', () => {
    expect(currentRawFormat(tab({ body: 'hello world' }))).toBe('Text');
  });
});

describe('setHeaderIfMissing', () => {
  it('adds the header when no matching name exists', () => {
    expect(setHeaderIfMissing({}, 'Content-Type', 'application/json')).toEqual({
      'Content-Type': 'application/json',
    });
  });
  it('is case-insensitive and leaves an existing header untouched', () => {
    const headers = { 'content-type': 'text/plain' };
    expect(setHeaderIfMissing(headers, 'Content-Type', 'application/json')).toBe(headers);
    expect(setHeaderIfMissing(headers, 'Content-Type', 'application/json')).toEqual({
      'content-type': 'text/plain',
    });
  });
  it('preserves other headers when adding', () => {
    expect(setHeaderIfMissing({ Accept: '*/*' }, 'X-Custom', 'v')).toEqual({
      Accept: '*/*',
      'X-Custom': 'v',
    });
  });
});

describe('enabledBodyParams', () => {
  it('keeps only enabled rows with a non-empty (trimmed) key', () => {
    const t = tab({
      bodyParams: [
        bp('a', '1'),
        bp('b', '2', false),
        bp('', 'no-key'),
        bp('   ', 'blank-key'),
        bp('c', ''),
      ],
    });
    expect(enabledBodyParams(t)).toEqual([bp('a', '1'), bp('c', '')]);
  });
  it('returns [] when there are no body params', () => {
    expect(enabledBodyParams(tab())).toEqual([]);
  });
});

describe('buildUrlEncodedBody', () => {
  it('encodes key/value pairs', () => {
    expect(buildUrlEncodedBody([bp('a', '1'), bp('b', '2')])).toBe('a=1&b=2');
  });
  it('percent-encodes spaces, ampersands and unicode', () => {
    expect(buildUrlEncodedBody([bp('full name', 'a&b'), bp('city', 'München')])).toBe(
      'full+name=a%26b&city=M%C3%BCnchen',
    );
  });
  it('returns an empty string for no rows', () => {
    expect(buildUrlEncodedBody([])).toBe('');
  });
});

describe('buildMultipartBody', () => {
  it('emits CRLF-delimited parts and a closing boundary', () => {
    const body = buildMultipartBody([bp('a', '1'), bp('b', 'two')], 'BOUND');
    expect(body).toBe(
      [
        '--BOUND',
        'Content-Disposition: form-data; name="a"',
        '',
        '1',
        '--BOUND',
        'Content-Disposition: form-data; name="b"',
        '',
        'two',
        '--BOUND--',
      ].join('\r\n'),
    );
  });
  it('escapes double quotes in the field name', () => {
    const body = buildMultipartBody([bp('a"b', 'v')], 'BOUND');
    expect(body).toContain('Content-Disposition: form-data; name="a%22b"');
  });
});

describe('buildRequestForSend', () => {
  it('GET with mode none sends no body and no Content-Type', () => {
    const t = tab({ method: 'GET', bodyMode: 'none', body: 'ignored' });
    const req = buildRequestForSend(t, 'https://api.example.com/?x=1');
    expect(req.url).toBe('https://api.example.com/?x=1');
    expect(req.body).toBeUndefined();
    expect(req.headers).toEqual({});
    expect(req.method).toBe('GET');
  });

  it('raw JSON body sets the body and defaults Content-Type to application/json', () => {
    const t = tab({ bodyMode: 'raw', rawBodyFormat: 'JSON', body: '{"ok":true}' });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBe('{"ok":true}');
    expect(req.headers['Content-Type']).toBe('application/json');
  });

  it('does not override an existing Content-Type for raw JSON', () => {
    const t: Tab = {
      ...tab({ bodyMode: 'raw', rawBodyFormat: 'JSON', body: '{"ok":true}' }),
    };
    t.request.headers = { 'content-type': 'application/vnd.api+json' };
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.headers).toEqual({ 'content-type': 'application/vnd.api+json' });
  });

  it('raw non-JSON body is sent without an added Content-Type', () => {
    const t = tab({ bodyMode: 'raw', rawBodyFormat: 'Text', body: 'plain text' });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBe('plain text');
    expect(req.headers).toEqual({});
  });

  it('empty raw body sends no body', () => {
    const t = tab({ bodyMode: 'raw', rawBodyFormat: 'JSON', body: '' });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBeUndefined();
    expect(req.headers).toEqual({});
  });

  it('urlencoded form sets the encoded body and Content-Type, skipping disabled rows', () => {
    const t = tab({
      bodyMode: 'urlencoded',
      bodyParams: [bp('a', '1'), bp('b', '2', false), bp('', 'no-key'), bp('c', 'x y')],
    });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBe('a=1&c=x+y');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('urlencoded with no enabled rows sends no body or header', () => {
    const t = tab({ bodyMode: 'urlencoded', bodyParams: [bp('a', '1', false)] });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBeUndefined();
    expect(req.headers).toEqual({});
  });

  it('multipart form-data leaves body assembly and boundary to the backend', () => {
    const t = tab({ bodyMode: 'form-data', bodyParams: [bp('a', '1'), bp('skip', 'x', false), bp('b', 'two')] });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBeUndefined();
    expect(req.headers).toEqual({});
    expect(req.bodyParams).toEqual([bp('a', '1'), bp('skip', 'x', false), bp('b', 'two')]);
  });

  it('form-data with no enabled rows sends no body or header', () => {
    const t = tab({ bodyMode: 'form-data', bodyParams: [] });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBeUndefined();
    expect(req.headers).toEqual({});
  });

  it('binary mode sends the raw body verbatim with no added Content-Type', () => {
    const t = tab({ bodyMode: 'binary', body: 'raw-bytes' });
    const req = buildRequestForSend(t, 'https://api.example.com');
    expect(req.body).toBe('raw-bytes');
    expect(req.headers).toEqual({});
  });

  it('preserves the original request fields and stamps the final url', () => {
    const t = tab({ method: 'PUT', bodyMode: 'none', headers: { Authorization: 'Bearer x' } });
    const req = buildRequestForSend(t, 'https://api.example.com/final');
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('https://api.example.com/final');
    expect(req.headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('adds bearer auth without overriding an explicit Authorization header', () => {
    const req = buildRequestForSend(
      tab({ bodyMode: 'none', auth: { type: 'bearer', bearerToken: 'token-1' } }),
      'https://api.example.com',
    );
    expect(req.headers.Authorization).toBe('Bearer token-1');

    const overridden = buildRequestForSend(
      tab({ bodyMode: 'none', headers: { authorization: 'Custom x' }, auth: { type: 'bearer', bearerToken: 'token-1' } }),
      'https://api.example.com',
    );
    expect(overridden.headers).toEqual({ authorization: 'Custom x' });
  });

  it('adds basic auth as a generated Authorization header', () => {
    const req = buildRequestForSend(
      tab({ bodyMode: 'none', auth: { type: 'basic', basicUsername: 'user', basicPassword: 'pass' } }),
      'https://api.example.com',
    );
    expect(req.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
  });

  it('adds API key auth to either headers or query params', () => {
    const headerReq = buildRequestForSend(
      tab({ bodyMode: 'none', auth: { type: 'apiKey', apiKeyName: 'x-api-key', apiKeyValue: 'secret', apiKeyIn: 'header' } }),
      'https://api.example.com',
    );
    expect(headerReq.headers['x-api-key']).toBe('secret');

    const queryReq = buildRequestForSend(
      tab({ bodyMode: 'none', auth: { type: 'apiKey', apiKeyName: 'api key', apiKeyValue: 'a&b', apiKeyIn: 'query' } }),
      'https://api.example.com/path?x=1#top',
    );
    expect(queryReq.url).toBe('https://api.example.com/path?x=1&api%20key=a%26b#top');
  });
});
