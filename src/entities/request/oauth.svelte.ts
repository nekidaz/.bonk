import { untrack } from 'svelte';
import { oauthForget, oauthLoginInput, oauthLoginStart, oauthLoginWait, oauthRevoke, oauthToken } from '$shared/ipc';
import {
  asOAuthFailure,
  oauthFailureText,
  oauthGrant,
  withOAuthBearer,
  type AuthConfig,
  type OAuthEnsured,
  type OAuthFailure,
  type OAuthLoginStarted,
  type RequestSettings,
} from '$shared/model';

type Scope = Record<string, string>;

/** A send that renewed its token on the way (OA7), for the Authorization tab's banner. */
export interface OAuthRenewal {
  /** Same as `oauthCardKey` of the auth that was renewed. */
  key: string;
  at: number;
  previousExpiresAt: number | null;
  /** By refresh_token (else a new grant). */
  byRefresh: boolean;
  tokenUrl: string;
  /** The request that went out with the new token. */
  sent?: { text: string; status: number; ms: number };
}

/**
 * OAuth state the token cards share: the browser login in progress, the last provider
 * failure, renewals made by sends. Tokens themselves live in the keychain; `version` is
 * bumped whenever one changes so cards re-read it.
 */
class OAuthRuntime {
  version = $state(0);
  /** One login at a time (Rust cancels an older one when a new one starts). */
  login = $state.raw<({ key: string } & OAuthLoginStarted) | null>(null);
  /** `redirectUri`: the one the failed login used, for «add this redirect address». */
  failure = $state.raw<{ key: string; error: OAuthFailure; redirectUri?: string } | null>(null);
  renewals = $state.raw<Record<string, OAuthRenewal>>({});

  changed(): void {
    this.version = untrack(() => this.version) + 1;
  }

  setRenewal(tabId: string, renewal: OAuthRenewal | undefined): void {
    const { [tabId]: _old, ...rest } = untrack(() => this.renewals);
    this.renewals = renewal ? { ...rest, [tabId]: renewal } : rest;
  }
}

export const oauthRuntime = new OAuthRuntime();

/** Which card a login / failure belongs to: the settings as written, in an environment. */
export function oauthCardKey(auth: AuthConfig, envId: string | null | undefined): string {
  return `${envId ?? ''}|${JSON.stringify(auth.oauth ?? {})}`;
}

/**
 * For an outgoing `oauth2` auth: a valid keychain token in `bearerToken` (refreshed or
 * re-fetched when it expired; `force` renews even a fresh one). Other auth passes through.
 * Throws a readable Error.
 */
export async function withOAuthToken(
  auth: AuthConfig | undefined,
  scope: Scope,
  settings: RequestSettings | undefined,
  force = false,
): Promise<{ auth: AuthConfig | undefined; ensured?: OAuthEnsured }> {
  if (auth?.type !== 'oauth2') return { auth };
  try {
    const ensured = await oauthToken(auth, scope, settings, force);
    if (ensured.renewed) oauthRuntime.changed();
    return { auth: withOAuthBearer(auth, ensured.token.accessToken), ensured };
  } catch (e) {
    throw new Error(oauthFailureText(e));
  }
}

/**
 * “Get token”: the code grant logs in through the browser; the others fetch directly.
 * Failures land in `oauthRuntime.failure` for the card (OA6).
 */
export async function getOAuthToken(
  auth: AuthConfig,
  scope: Scope,
  key: string,
  settings?: RequestSettings,
): Promise<void> {
  oauthRuntime.failure = null;
  let redirectUri: string | undefined;
  try {
    if (oauthGrant(auth.oauth) !== 'authorization_code') {
      await oauthToken(auth, scope, settings, true);
      return;
    }
    const started = await oauthLoginStart(auth, scope);
    redirectUri = started.redirectUri;
    oauthRuntime.login = { key, ...started };
    try {
      await oauthLoginWait(started.flowId, settings);
    } finally {
      if (untrack(() => oauthRuntime.login?.flowId) === started.flowId) oauthRuntime.login = null;
    }
  } catch (e) {
    const error = asOAuthFailure(e);
    const cancelled = error.kind === 'other' && /cancelled|has ended/.test(error.message);
    if (!cancelled) oauthRuntime.failure = { key, error, redirectUri };
  } finally {
    oauthRuntime.changed();
  }
}

/** A code (or the whole redirect URL) pasted by hand into the waiting login. */
export function pasteOAuthCode(input: string): void {
  const login = oauthRuntime.login;
  if (login && input.trim()) void oauthLoginInput(login.flowId, input.trim());
}

export function cancelOAuthLogin(): void {
  const login = oauthRuntime.login;
  if (login) void oauthLoginInput(login.flowId, null);
}

/** “Refresh”: a refresh (or a new grant) now. */
export async function refreshOAuthToken(
  auth: AuthConfig,
  scope: Scope,
  key: string,
  settings?: RequestSettings,
): Promise<void> {
  oauthRuntime.failure = null;
  try {
    await oauthToken(auth, scope, settings, true);
  } catch (e) {
    oauthRuntime.failure = { key, error: asOAuthFailure(e) };
  } finally {
    oauthRuntime.changed();
  }
}

/** “Delete”: forget the token in bonk only. */
export async function forgetOAuthToken(auth: AuthConfig, scope: Scope): Promise<void> {
  await oauthForget(auth, scope);
  oauthRuntime.changed();
}

/** “Revoke”: the provider's revocation endpoint, then forget. */
export async function revokeOAuthToken(
  auth: AuthConfig,
  scope: Scope,
  key: string,
  settings?: RequestSettings,
): Promise<void> {
  oauthRuntime.failure = null;
  try {
    await oauthRevoke(auth, scope, settings);
  } catch (e) {
    oauthRuntime.failure = { key, error: asOAuthFailure(e) };
  } finally {
    oauthRuntime.changed();
  }
}
