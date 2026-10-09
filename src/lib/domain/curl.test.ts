import { describe, expect, it } from 'vitest';
import { parseCurl, toCurl } from './curl';
import type { Tab } from './types';

describe('parseCurl', () => {
  it('parses method, headers, url and json body', () => {
    const req = parseCurl(
      `curl 'https://api.example.com/users' -X POST -H 'Authorization: Bearer token' -H 'Content-Type: application/json' -d '{"name":"Ada"}'`,
    );

    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/users');
    expect(req.headers.Authorization).toBe('Bearer token');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.body).toBe('{"name":"Ada"}');
  });

  it('infers POST when data is present', () => {
    const req = parseCurl(`curl https://example.com -d a=1`);
    expect(req.method).toBe('POST');
    expect(req.body).toBe('a=1');
  });

  it('imports form-data fields and files', () => {
    const req = parseCurl(`curl https://example.com -F name=bonk -F avatar=@/tmp/avatar.png;type=image/png`);
    expect(req.method).toBe('POST');
    expect(req.bodyMode).toBe('form-data');
    expect(req.bodyParams).toEqual([
      { key: 'name', value: 'bonk', description: '', enabled: true, kind: 'text' },
      { key: 'avatar', value: 'avatar.png', description: '', enabled: true, kind: 'file', filePath: '/tmp/avatar.png' },
    ]);
  });

  it('imports basic auth from curl user flag', () => {
    const req = parseCurl(`curl https://example.com -u ada:secret`);
    expect(req.auth).toEqual({ type: 'basic', basicUsername: 'ada', basicPassword: 'secret' });
  });

  it('moves -d data to the query string with -G (GET, no body)', () => {
    const req = parseCurl(`curl -G https://example.com/search -d q=cats -d page=2`);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://example.com/search?q=cats&page=2');
    expect(req.body).toBeUndefined();
  });

  it('url-encodes --data-urlencode content while keeping the field name', () => {
    const req = parseCurl(`curl https://example.com --data-urlencode 'msg=hello world&x'`);
    expect(req.method).toBe('POST');
    expect(req.body).toBe('msg=hello%20world%26x');
  });
});

describe('toCurl', () => {
  const tab = (request: Tab['request']): Tab => ({ id: 't', protocol: 'http', title: 'T', request });

  it('serializes method, headers and a JSON body', () => {
    const out = toCurl(
      tab({
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name":"Ada"}',
        bodyMode: 'raw',
      }),
    );
    expect(out).toContain("curl 'https://api.example.com/users'");
    expect(out).toContain('--request POST');
    expect(out).toContain("--header 'Content-Type: application/json'");
    expect(out).toContain(`--data '{"name":"Ada"}'`);
  });

  it('omits --request and body for a plain GET', () => {
    expect(toCurl(tab({ method: 'GET', url: 'https://h/x', headers: {} }))).toBe("curl 'https://h/x'");
  });

  it('round-trips back through parseCurl', () => {
    const out = toCurl(
      tab({ method: 'POST', url: 'https://h/x', headers: { 'X-A': '1' }, body: 'hello', bodyMode: 'raw' }),
    );
    const back = parseCurl(out);
    expect(back.method).toBe('POST');
    expect(back.url).toBe('https://h/x');
    expect(back.headers['X-A']).toBe('1');
    expect(back.body).toBe('hello');
  });

  it("escapes a single quote in a header value with the '\\'' idiom", () => {
    const out = toCurl(
      tab({ method: 'GET', url: 'https://h/x', headers: { Authorization: "Bearer o'Hara" } }),
    );
    expect(out).toContain(`--header 'Authorization: Bearer o'\\''Hara'`);
    const back = parseCurl(out);
    expect(back.headers.Authorization).toBe("Bearer o'Hara");
  });

  it("escapes a single quote in the body with the '\\'' idiom", () => {
    const out = toCurl(
      tab({ method: 'POST', url: 'https://h/x', headers: {}, body: "it's fine", bodyMode: 'raw' }),
    );
    expect(out).toContain(`--data 'it'\\''s fine'`);
    const back = parseCurl(out);
    expect(back.body).toBe("it's fine");
  });

  it("escapes a nested '\\'' sequence in the body without breaking quoting", () => {
    const body = `a'\\''b`;
    const out = toCurl(tab({ method: 'POST', url: 'https://h/x', headers: {}, body, bodyMode: 'raw' }));
    expect(out).toContain(`--data 'a'\\''\\'\\'''\\''b'`);
    const back = parseCurl(out);
    expect(back.body).toBe(body);
  });

  it("escapes a single quote in the URL with the '\\'' idiom", () => {
    const out = toCurl(tab({ method: 'GET', url: "https://h/o'Hara", headers: {} }));
    expect(out).toContain(`curl 'https://h/o'\\''Hara'`);
    const back = parseCurl(out);
    expect(back.url).toBe("https://h/o'Hara");
  });
});
