import type { AuthConfig, OAuthConfig, OAuthFailure, OAuthGrant } from './types';

export function oauthGrant(oauth: OAuthConfig | undefined): OAuthGrant {
  return oauth?.grant || 'authorization_code';
}

export function oauthScopes(oauth: OAuthConfig | undefined): string[] {
  return (oauth?.scope ?? '').split(/\s+/).filter(Boolean);
}

/** The host of a URL that may still hold `{{vars}}`; '' when it doesn't parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The JWT payload, or null when `token` is not a JWT (an opaque token). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part || token.split('.').length !== 3) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')), (c) =>
      c.charCodeAt(0),
    );
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Anything an OAuth command rejected with, as an `OAuthFailure`. */
export function asOAuthFailure(e: unknown): OAuthFailure {
  if (e && typeof e === 'object' && 'kind' in e) return e as OAuthFailure;
  return { kind: 'other', message: e instanceof Error ? e.message : String(e) };
}

/** One line for a send error / the console. Mirrors `Display for OAuthError`. */
export function oauthFailureText(e: unknown): string {
  const f = asOAuthFailure(e);
  if (f.kind === 'other') return f.message;
  if (f.kind === 'login') return `OAuth: ${f.reason} — get a token on the request's Authorization tab`;
  const head = `OAuth: ${f.error || 'error'}${f.description ? `: ${f.description}` : ''}`;
  return f.status ? `${head} (HTTP ${f.status})` : head;
}

/** The outgoing copy of `auth` with the keychain token in it (request_prep sends it as Bearer). */
export function withOAuthBearer(auth: AuthConfig, accessToken: string): AuthConfig {
  return { ...auth, bearerToken: accessToken };
}
