/**
 * Dynamic variables (Flow · Динамические переменные): `{{$guid}}`, `{{$randomEmail}}` … — Postman's
 * names, a fresh value at every send. Rust generates the values (domain/dynamic_vars.rs); this is the
 * catalog the editor needs: which names exist, their groups, the nearest name for a typo.
 * `dynamicVars.json` is shared with Rust's test, so the two lists can't drift.
 */
import catalog from './dynamicVars.json';
import { findVariables } from './vars';

export type DynamicGroup = 'time' | 'id' | 'numbers' | 'text' | 'people' | 'internet' | 'finance' | 'address' | 'files';

export interface DynamicVar {
  /** With the leading `$`. */
  name: string;
  group: DynamicGroup;
}

export const DYNAMIC_VARS = catalog as DynamicVar[];

/** Groups in catalog order. */
export const DYNAMIC_GROUPS = [...new Set(DYNAMIC_VARS.map((v) => v.group))];

const KNOWN = new Set(DYNAMIC_VARS.map((v) => v.name));

/** Names with `$` are reserved for dynamic variables: environments can't define them. */
export const isDynamicName = (name: string): boolean => name.startsWith('$');

export const isKnownDynamic = (name: string): boolean => KNOWN.has(name);

/** How Rust generates the values (Settings → Variables). */
export interface DynamicOptions {
  /** 'ru': Kazakh/Russian names, KZ cities and +7 phones; 'en': US. */
  locale: 'ru' | 'en';
  /** One value per name within a request, else a new one at every occurrence. */
  perRequest: boolean;
  /** Same «random» values on every run. */
  seed: number | null;
}

/** A value that went into a sent request. */
export interface DynamicValue {
  name: string;
  value: string;
}

/** `{{$typo}}` occurrences in `text` (unknown dynamic names, which go out as text). */
export function unknownDynamicCount(text: string): number {
  return findVariables(text).filter((m) => isDynamicName(m.name) && !isKnownDynamic(m.name)).length;
}

/** The catalog name closest to a typo (`$randomEmial` → `$randomEmail`), if any is close enough. */
export function nearestDynamic(name: string): string | undefined {
  const typo = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(typo.length / 4)) + 1;
  for (const { name: candidate } of DYNAMIC_VARS) {
    const d = editDistance(typo, candidate.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return best;
}

/** Levenshtein distance, one row at a time. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Catalog rows matching `query` by name or by meaning: `describe(name)` is the localized
 * description, so «почта» finds `$randomEmail`. An empty query matches everything.
 */
export function searchDynamic(query: string, describe: (name: string) => string): DynamicVar[] {
  const q = query.trim().replace(/^\$/, '').toLowerCase();
  if (!q) return DYNAMIC_VARS;
  return DYNAMIC_VARS.filter((v) => v.name.toLowerCase().includes(q) || describe(v.name).toLowerCase().includes(q));
}
