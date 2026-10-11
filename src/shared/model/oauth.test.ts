import { describe, expect, it } from 'vitest';
import { decodeJwt, oauthFailureText, oauthGrant, oauthScopes, urlHost } from './oauth';

describe('oauth helpers', () => {
  it('decodes a JWT payload and ignores opaque tokens', () => {
    const payload = btoa(JSON.stringify({ sub: 'usr_7f2a91', name: 'a', exp: 1 }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(decodeJwt(`eyJhbGciOiJub25lIn0.${payload}.sig`)).toEqual({ sub: 'usr_7f2a91', name: 'a', exp: 1 });
    expect(decodeJwt('opaque-token')).toBeNull();
    expect(decodeJwt('a.%%%.c')).toBeNull();
  });

  it('reads UTF-8 claims', () => {
    const json = new TextEncoder().encode(JSON.stringify({ name: 'Ару' }));
    const b64 = btoa(String.fromCharCode(...json)).replace(/=+$/, '');
    expect(decodeJwt(`h.${b64}.s`)).toEqual({ name: 'Ару' });
  });

  it('defaults the grant and splits scopes', () => {
    expect(oauthGrant(undefined)).toBe('authorization_code');
    expect(oauthGrant({ grant: 'password' })).toBe('password');
    expect(oauthScopes({ scope: ' a  b\nc ' })).toEqual(['a', 'b', 'c']);
    expect(urlHost('https://accounts.test/oauth')).toBe('accounts.test');
    expect(urlHost('{{auth_host}}/oauth')).toBe('');
  });

  it('words failures like Rust does', () => {
    expect(
      oauthFailureText({ kind: 'provider', status: 400, url: '', error: 'invalid_grant', description: 'x', body: '' }),
    ).toBe('OAuth: invalid_grant: x (HTTP 400)');
    expect(oauthFailureText({ kind: 'other', message: 'boom' })).toBe('boom');
    expect(oauthFailureText(new Error('e'))).toBe('e');
  });
});
