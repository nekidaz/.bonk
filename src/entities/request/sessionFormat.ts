import { t } from '$shared/i18n';
import { sessionTone, type SessionInfo } from '$shared/model';
import { oauthClock, oauthSpan } from './oauthFormat';

export { oauthClock as sessionClock, oauthSpan as sessionSpan };

/** «ещё 41 мин» / «access обновится при отправке» / «refresh истёк · нужен вход» / «нет сессии». */
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
