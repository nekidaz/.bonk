import { CM_PARSE_BUDGET } from './responseRender';
import { queryJsonPath } from './jsonPath';

const parsedCache = new WeakMap<object, unknown>();

/** Parsed JSON body, once per response object; undefined when too large to parse or not JSON. */
export function parsedBody(source: { body: string }): unknown {
  if (source.body.length > CM_PARSE_BUDGET) return undefined;
  if (!parsedCache.has(source)) {
    let v: unknown;
    try {
      v = JSON.parse(source.body);
    } catch {
      v = undefined;
    }
    parsedCache.set(source, v);
  }
  return parsedCache.get(source);
}

export type FilterOutcome =
  | { kind: 'none' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; text: string; matches: number };

/** Run the JSONPath filter and pretty-print the matches (what the viewer shows instead of the full body). */
export function applyFilter(source: { body: string }, path: string): FilterOutcome {
  const p = path.trim();
  if (!p) return { kind: 'none' };
  const root = parsedBody(source);
  if (root === undefined) return { kind: 'error', error: 'Not JSON' };
  const r = queryJsonPath(root, p);
  if (!r.ok) return { kind: 'error', error: r.error };
  return { kind: 'ok', text: JSON.stringify(r.values, null, 2) ?? '[]', matches: r.values.length };
}
