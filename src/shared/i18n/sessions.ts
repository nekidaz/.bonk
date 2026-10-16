// Sessions dialog (Flow · Session SE6): one session per environment of a collection.
export const en = {
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
