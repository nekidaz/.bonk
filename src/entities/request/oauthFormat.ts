import { t } from '$shared/i18n';
import { oauthGrant, oauthScopes, urlHost, type OAuthConfig, type OAuthTokenInfo } from '$shared/model';

/** «59 мин», «2 ч», «3 д». */
export function oauthSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('oauth.unit.now');
  if (s < 3600) return t('oauth.unit.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('oauth.unit.h', { n: Math.floor(s / 3600) });
  return t('oauth.unit.d', { n: Math.floor(s / 86400) });
}

/** Local «13:04» for unix seconds. */
export const oauthClock = (seconds: number): string =>
  new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Same skew as `EXPIRY_SKEW` in oauth.rs: a token about to die counts as dead. */
export const oauthExpired = (token: OAuthTokenInfo, now: number): boolean =>
  token.expiresAt !== null && now + 30 >= token.expiresAt;

/** «ещё 59 мин» / «истёк 2 ч назад» / «без срока». */
export function oauthLeft(token: OAuthTokenInfo, now: number): string {
  if (token.expiresAt === null) return t('oauth.no_expiry');
  return oauthExpired(token, now)
    ? t('oauth.expired.ago', { n: oauthSpan(now - token.expiresAt) })
    : t('oauth.left', { n: oauthSpan(token.expiresAt - now) });
}

export function oauthGrantLabel(oauth: OAuthConfig | undefined): string {
  const grant = oauthGrant(oauth);
  const label = t(`oauth.grant.${grant}`);
  return grant === 'authorization_code' && oauth?.pkce !== false ? `${label} + PKCE` : label;
}

/** «Authorization Code + PKCE · accounts.test · 3 scope», hosts from resolved URLs. */
export function oauthSummary(oauth: OAuthConfig | undefined, resolve: (s: string) => string): string {
  const url = oauthGrant(oauth) === 'authorization_code' ? oauth?.authUrl : oauth?.tokenUrl;
  const host = urlHost(resolve(url ?? ''));
  const n = oauthScopes(oauth).length;
  return [oauthGrantLabel(oauth), host, n ? t('oauth.summary.scopes', { n }) : ''].filter(Boolean).join(' · ');
}

/** «eyJhbGciOi…mQ3x0». */
export const oauthShortToken = (token: string): string =>
  token.length <= 24 ? token : `${token.slice(0, 10)}…${token.slice(-5)}`;
