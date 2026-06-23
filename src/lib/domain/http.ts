import type { Param } from './types';

function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex === -1) return { base: beforeHash, query: '', hash };
  return {
    base: beforeHash.slice(0, queryIndex),
    query: beforeHash.slice(queryIndex + 1),
    hash,
  };
}

export function paramsFromUrl(url: string): Param[] {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');
      const rawKey = eq === -1 ? part : part.slice(0, eq);
      const rawValue = eq === -1 ? '' : part.slice(eq + 1);
      return {
        key: decodeQueryPart(rawKey),
        value: decodeQueryPart(rawValue),
        description: '',
        enabled: true,
      };
    });
}

/**
 * Re-derive the Params table from a hand-edited URL while preserving metadata
 * the URL can't carry: per-row descriptions (matched by key) and disabled rows
 * (intentionally absent from the URL, so a naive re-parse would silently delete
 * them). Used when the user edits the address bar directly.
 */
export function mergeParamsFromUrl(url: string, prev: Param[] | undefined): Param[] {
  const old = prev ?? [];
  const descByKey = new Map<string, string>();
  for (const row of old) {
    if (row.description && !descByKey.has(row.key)) descByKey.set(row.key, row.description);
  }
  const merged = paramsFromUrl(url).map((row) => ({
    ...row,
    description: descByKey.get(row.key) ?? '',
  }));
  const disabled = old.filter((row) => !row.enabled);
  return [...merged, ...disabled];
}

function decodeQueryPart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

/**
 * Percent-encode a query key/value, but leave `{{var}}` placeholders intact so
 * environment-variable templates survive the URL ↔ params round-trip.
 */
export function encodeQueryPart(s: string): string {
  return s
    .split(/(\{\{[^}]*\}\})/)
    .map((seg) => (seg.startsWith('{{') && seg.endsWith('}}') ? seg : encodeURIComponent(seg)))
    .join('');
}

export function syncUrlWithParams(url: string, params: Param[] | undefined): string {
  const rows = params ?? [];
  if (rows.length === 0) return url;
  const pairs = rows
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => `${encodeQueryPart(p.key.trim())}=${encodeQueryPart(p.value)}`);
  const { base, hash } = splitUrl(url);
  return pairs.length > 0 ? `${base}?${pairs.join('&')}${hash}` : `${base}${hash}`;
}

/**
 * Resolve the visual URL + Params table into the final URL sent to Rust.
 * If the Params table is in use, it owns the query string so repeated sends
 * don't duplicate `?a=1&a=1`.
 */
export function buildUrl(url: string, params: Param[] | undefined): string {
  return syncUrlWithParams(url, params);
}

/** Human-readable byte size, e.g. 1234 -> "1.2 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
