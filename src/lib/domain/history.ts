export function pushCapped<T>(list: T[], item: T, cap: number): T[] {
  return [item, ...list].slice(0, cap);
}
