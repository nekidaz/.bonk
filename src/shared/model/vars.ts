/**
 * Pure `{{var}}` resolution engine (Postman-style environments + globals). This
 * module is a leaf: it imports only types, never stores, so the stores import
 * graph stays acyclic (state imports it; requests imports it).
 */
import { t as tr } from '$shared/i18n';
import type { AuthConfig, Environment, HttpRequest, TreeNode, VarRow } from './types';
import { applyAuth } from './httpBody';

/** Matches a `{{ name }}` placeholder, capturing the (possibly padded) name. */
const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Keep only rows that contribute a resolvable variable (enabled, non-empty key). */
function usableRows(rows: VarRow[]): VarRow[] {
  return rows.filter((row) => row.enabled && row.key.trim() !== '');
}

/**
 * Flatten globals + the active environment into a single `name → value` map.
 * Only enabled rows with a non-empty key participate; the active environment
 * overrides globals on key collisions (env wins, matching Postman). With
 * `redactSecrets`, secret rows keep their literal `{{key}}` (for cURL / snippets).
 */
export function mergeScope(
  globals: VarRow[],
  activeEnv: Environment | undefined,
  redactSecrets = false,
): Record<string, string> {
  const scope: Record<string, string> = {};
  const put = (row: VarRow): void => {
    const key = row.key.trim();
    scope[key] = redactSecrets && row.secret ? `{{${key}}}` : row.value;
  };
  for (const row of usableRows(globals)) put(row);
  if (activeEnv) for (const row of usableRows(activeEnv.vars)) put(row);
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
export function lookupVar(name: string, globals: VarRow[], activeEnv: Environment | undefined): VarLookup | null {
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
 * than silently blanked. Handles multiple occurrences. `{{$name}}` is reserved for
 * dynamic variables, which only Rust generates at send time: previews keep it as written.
 */
export function resolveVars(text: string, scope: Record<string, string>): string {
  return text.replace(VAR_RE, (match, rawName: string) => {
    const name = rawName.trim();
    return !name.startsWith('$') && Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : match;
  });
}

/**
 * Return a copy of `req` with `resolveVars` applied to the URL, every header
 * key and value, the body (when present) and the auth fields, then the auth
 * applied (`applyAuth`). The input is never mutated.
 */
export function resolveRequestVars(req: HttpRequest, scope: Record<string, string>): HttpRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    headers[resolveVars(key, scope)] = resolveVars(value, scope);
  }
  let body = req.body === undefined ? req.body : resolveVars(req.body, scope);
  if (req.bodyMode === 'graphql' && body !== undefined) {
    const source = req.graphqlVariables?.trim();
    let variables: unknown = {};
    if (source) {
      try {
        variables = JSON.parse(source);
      } catch {
        throw new Error(tr('http.gql.vars_invalid'));
      }
      if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) {
        throw new Error(tr('http.gql.vars_object'));
      }
    }
    const resolveValue = (value: unknown): unknown => {
      if (typeof value === 'string') return resolveVars(value, scope);
      if (Array.isArray(value)) return value.map(resolveValue);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolveValue(nested)]));
      }
      return value;
    };
    body = JSON.stringify({ query: body, variables: resolveValue(variables) });
  }
  return applyAuth({
    ...req,
    url: resolveVars(req.url, scope),
    headers,
    body,
    ...(req.binaryFilePath === undefined ? {} : { binaryFilePath: resolveVars(req.binaryFilePath, scope) }),
    ...(req.auth === undefined ? {} : { auth: resolveAuthVars(req.auth, scope) }),
  });
}

function resolveAuthVars(auth: AuthConfig, scope: Record<string, string>): AuthConfig {
  const fields = ['bearerToken', 'basicUsername', 'basicPassword', 'apiKeyName', 'apiKeyValue'] as const;
  const out = { ...auth };
  for (const field of fields) {
    const value = auth[field];
    if (value !== undefined) out[field] = resolveVars(value, scope);
  }
  return out;
}

/** Saved requests (any depth) that reference at least one of `keys` as `{{key}}` anywhere in their definition. */
export function countRequestsUsingVars(nodes: TreeNode[], keys: string[]): number {
  const wanted = new Set(keys.map((k) => k.trim()).filter(Boolean));
  if (wanted.size === 0) return 0;
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'folder') n += countRequestsUsingVars(node.children, keys);
    else if (findVariables(JSON.stringify([node.request, node.params, node.grpc])).some((m) => wanted.has(m.name))) n++;
  }
  return n;
}

/** Display mask for a secret value: short prefix, dots, last 4 chars (`sk_live_••••••••••••4f2a`). */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  const prefix = Math.min(8, value.length - 8);
  // Fixed-width mask (S31): the length of a secret is itself a hint.
  return value.slice(0, prefix) + '•'.repeat(12) + value.slice(-4);
}
