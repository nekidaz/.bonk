/** Replace a leading home directory with `~`. */
export function abbrevHome(path: string, home: string): string {
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}
