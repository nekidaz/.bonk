// Session auth (Flow · Сессия: вошёл один раз): the Authorization tab's settings and card, the renewal
// banner and timeline of a send. The Sessions dialog is in ./sessions, the Runner card and the sign-in
// prompt in ./sessionrun.
export const ru = {
  'session.left': 'ещё {n}',
  'session.noExpiry': 'без срока',
  'session.renewOnSend': 'access обновится при отправке',
  'session.refreshDead': 'refresh истёк · нужен вход',
  'session.accessDead': 'истёк · нужен вход',
  'session.none': 'нет сессии',
};

export const en: Record<keyof typeof ru, string> = {
  'session.left': '{n} left',
  'session.noExpiry': 'no expiry',
  'session.renewOnSend': 'access renews on send',
  'session.refreshDead': 'refresh expired · sign in needed',
  'session.accessDead': 'expired · sign in needed',
  'session.none': 'no session',
};
