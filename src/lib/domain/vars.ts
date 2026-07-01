/**
 * Pure `{{var}}` resolution engine (Postman-style environments + globals). This
 * module is a leaf: it imports only types, never stores, so the stores import
 * graph stays acyclic (state imports it; requests imports it).
 */
import type { Environment, HttpRequest, VarRow } from './types';

/** Matches a `{{ name }}` placeholder, capturing the (possibly padded) name. */
const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Keep only rows that contribute a resolvable variable (enabled, non-empty key). */
function usableRows(rows: VarRow[]): VarRow[] {
  return rows.filter((row) => row.enabled && row.key.trim() !== '');
}

/**
 * Flatten globals + the active environment into a single `name → value` map.
 * Only enabled rows with a non-empty key participate; the active environment
 * overrides globals on key collisions (env wins, matching Postman).
 */
export function mergeScope(
  globals: VarRow[],
  activeEnv: Environment | undefined,
): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const row of usableRows(globals)) scope[row.key.trim()] = row.value;
  if (activeEnv) {
    for (const row of usableRows(activeEnv.vars)) scope[row.key.trim()] = row.value;
  }
  return scope;
}

/** A `{{ name }}` occurrence in a piece of text (offsets cover the braces). */
export interface VarMatch {
  /** The trimmed variable name between the braces. */
  name: string;
  /** Offset of the opening `{{`. */
  from: number;
  /** Offset just past the closing `}}`. */
  to: number;
}

/**
 * Find every `{{ name }}` placeholder in `text`. Names are trimmed exactly the
 * way `resolveVars` trims them, so a match resolves iff its `name` is in scope.
 * Used by the editor's inline `{{var}}` decorations and hover popover.
 */
export function findVariables(text: string): VarMatch[] {
  const re = new RegExp(VAR_RE.source, 'g');
  const out: VarMatch[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ name: m[1].trim(), from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Where a variable's value came from when it resolved. */
export interface VarLookup {
  value: string;
  source: 'env' | 'globals';
}

/**
 * Resolve a single variable name the same way `mergeScope` would: the active
 * environment wins over globals, only enabled rows with a matching trimmed key
 * count, and on duplicate keys the *last* enabled row wins (mirroring the
 * last-write-wins map build in `mergeScope`). Returns `null` when unresolved.
 */
export function lookupVar(
  name: string,
  globals: VarRow[],
  activeEnv: Environment | undefined,
): VarLookup | null {
  const key = name.trim();
  if (key === '') return null;
  const lastMatch = (rows: VarRow[]): VarRow | undefined => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.enabled && row.key.trim() === key) return row;
    }
    return undefined;
  };
  if (activeEnv) {
    const hit = lastMatch(activeEnv.vars);
    if (hit) return { value: hit.value, source: 'env' };
  }
  const hit = lastMatch(globals);
  return hit ? { value: hit.value, source: 'globals' } : null;
}

/**
 * Replace every `{{ name }}` in `text` with `scope[name]`. Surrounding
 * whitespace inside the braces is trimmed before lookup. Unknown names are left
 * untouched (the literal `{{ name }}` is preserved) so a typo is visible rather
 * than silently blanked. Handles multiple occurrences.
 */
export function resolveVars(text: string, scope: Record<string, string>): string {
  return text.replace(VAR_RE, (match, rawName: string) => {
    const name = rawName.trim();
    return Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : match;
  });
}

/**
 * Return a copy of `req` with `resolveVars` applied to the URL, every header
 * key and value, and the body (when present). The input is never mutated.
 */
export function resolveRequestVars(req: HttpRequest, scope: Record<string, string>): HttpRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    headers[resolveVars(key, scope)] = resolveVars(value, scope);
  }
  return {
    ...req,
    url: resolveVars(req.url, scope),
    headers,
    body: req.body === undefined ? req.body : resolveVars(req.body, scope),
  };
}
