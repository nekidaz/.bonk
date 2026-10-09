import type { Param, RequestNode, Tab } from './types';

/** JSON with empty values dropped, so `body: ''` vs a missing body (or a trailing blank param row) never reads as a change. */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canon).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canon(v)] as const)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === '' || value === null ? undefined : value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const realParams = (ps: Param[] | undefined): Param[] => (ps ?? []).filter((p) => p.key || p.value || p.description);

/** A tab backed by a saved request differs from what is on disk (S09 «Изменён · не сохранён»). */
export function isTabDirty(tab: Tab, saved: RequestNode | undefined): boolean {
  if (!saved || (tab.protocol !== 'http' && tab.protocol !== 'grpc')) return false;
  if (tab.title !== saved.name) return true;
  if (tab.protocol === 'grpc') {
    const pick = (g: Tab['grpc']) => g && { endpoint: g.endpoint, method: g.method, message: g.message, metadata: g.metadata, plaintext: g.plaintext };
    return !same(pick(tab.grpc), pick(saved.grpc));
  }
  return !same(tab.request, saved.request) || !same(realParams(tab.params), realParams(saved.params));
}

/** Param row `i` differs from the saved row at the same position. */
export function isParamChanged(tab: Tab, saved: RequestNode | undefined, i: number): boolean {
  if (!saved) return false;
  const row = tab.params?.[i];
  if (!row || !(row.key || row.value || row.description)) return false;
  return !same(row, saved.params?.[i]);
}


/** A never-saved request tab holds something worth keeping: closing it asks first, like Postman. Picker defaults (method, body mode, no auth) alone don't count. */
export function isScratchDirty(tab: Tab): boolean {
  if (tab.savedPath) return false;
  if (tab.protocol === 'grpc') return !!tab.grpc?.endpoint.trim();
  if (tab.protocol !== 'http') return false;
  const { method: _m, bodyMode: _b, rawBodyFormat: _r, auth, ...rest } = tab.request;
  return !same(rest, {}) || realParams(tab.params).length > 0 || (!!auth && auth.type !== 'none' && auth.type !== 'inherit');
}
