import { describe, expect, it } from 'vitest';
import { parseCurl } from '../src/lib/domain/curl';

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
});
