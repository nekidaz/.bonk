import { t } from '$shared/i18n';
import { sessionTone, type SessionInfo } from '$shared/model';
import { oauthClock, oauthSpan } from './oauthFormat';

export { oauthClock as sessionClock, oauthSpan as sessionSpan };

/** “41 min left” / “access renews on send” / “refresh expired · sign in needed” / “no session”. */
export function sessionStatusText(info: SessionInfo | null | undefined, now: number): string {
  switch (sessionTone(info, now)) {
    case 'ok':
      return info?.accessExp == null
        ? t('session.noExpiry')
        : t('session.left', { n: oauthSpan(info.accessExp - now) });
    case 'renew':
      return t('session.renewOnSend');
    case 'dead':
      return info?.hasRefresh ? t('session.refreshDead') : t('session.accessDead');
    default:
      return t('session.none');
  }
}
