export function pushCapped<T>(list: T[], item: T, cap: number): T[] {
  return [item, ...list].slice(0, cap);
}

/** Drop entries older than `days` (by `at`); 0 = keep everything. Returns the same list when nothing is dropped. */
export function pruneByAge<T extends { at: number }>(list: T[], days: number, now = Date.now()): T[] {
  if (days <= 0) return list;
  const cutoff = now - days * 86_400_000;
  const kept = list.filter((e) => e.at >= cutoff);
  return kept.length === list.length ? list : kept;
}
