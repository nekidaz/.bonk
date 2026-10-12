// Sessions dialog (Flow · Сессия SE6): one session per environment of a collection.
export const ru = {
  'sessions.title': 'Сессии',
  'sessions.lede':
    'Одна сессия на окружение. Вошёл в Staging — все запросы коллекции идут с этим токеном, Production не трогается.',
  'sessions.env': 'Окружение',
  'sessions.who': 'Кто вошёл',
  'sessions.login': 'Вход',
  'sessions.status': 'Статус',
  'sessions.signIn': 'Войти',
  'sessions.refresh': 'Обновить access',
  'sessions.signOut': 'Выйти',
  'sessions.busy': 'Идёт вход…',
  'sessions.all.title': 'Выйти везде',
  'sessions.all.sub': 'Удаляет сессии во всех окружениях. Следующий запрос сам запустит вход и попросит OTP.',
  'sessions.all.confirm': 'Точно? Удалить все',
  'sessions.keychain': 'Сессии лежат в связке ключей macOS — не в файлах воркспейса, не в git и не в экспорте.',
  'sessions.done': 'Готово',
};

export const en: Record<keyof typeof ru, string> = {
  'sessions.title': 'Sessions',
  'sessions.lede':
    'One session per environment. Sign in to Staging and every request of the collection uses that token; Production stays untouched.',
  'sessions.env': 'Environment',
  'sessions.who': 'Signed in as',
  'sessions.login': 'Sign-in',
  'sessions.status': 'Status',
  'sessions.signIn': 'Sign in',
  'sessions.refresh': 'Renew access',
  'sessions.signOut': 'Sign out',
  'sessions.busy': 'Signing in…',
  'sessions.all.title': 'Sign out everywhere',
  'sessions.all.sub':
    'Deletes the sessions in every environment. The next request signs in by itself and asks for the OTP.',
  'sessions.all.confirm': 'Sure? Delete all',
  'sessions.keychain': 'Sessions live in the macOS keychain: not in workspace files, not in git, not in exports.',
  'sessions.done': 'Done',
};
