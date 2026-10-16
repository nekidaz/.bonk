// Re-import (IM8): the same spec, a new version. Requests are matched by their spec link, and each
// one is merged three-way — what the last import generated (`spec.base`), what the user has now,
// what the new spec generates — so the user's edits survive and untouched fields follow the spec.
import type { FolderNode, RequestNode, SpecBase, TreeNode } from '$shared/model';
import { t } from '$shared/i18n';
import { requestsIn, type Plan, type PlanFolder, type PlanItem, type PlanRequest } from './plan';

/** What an import generated for `node`: the fields a re-import compares and merges. */
export function fingerprint(node: RequestNode): SpecBase {
  const r = node.request;
  return {
    method: r.method,
    url: r.url,
    params: (node.params ?? []).map((p) => [p.key, p.value]),
    headers: { ...r.headers },
    body: r.body ?? '',
  };
}

export interface Added {
  key: string;
  req: PlanRequest;
  /** Folder in the collection it goes to (null = the collection itself). */
  folder: string | null;
  folderExists: boolean;
}

export interface Changed {
  key: string;
  /** Saved request id (`fs:…`). */
  id: string;
  current: RequestNode;
  merged: RequestNode;
  /** Short human list: `new query: created_from`, `body: +metadata, amount → integer`. */
  what: string[];
  /** Body before/after when the spec changed it; `updated` = the user's body follows (they didn't edit it). */
  body?: { before: string; after: string; updated: boolean };
}

export interface Removed {
  key: string;
  id: string;
  node: RequestNode;
}

export interface Diff {
  added: Added[];
  changed: Changed[];
  removed: Removed[];
  unchanged: number;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** JSON value type in schema words, for `amount → integer`. */
function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Top-level field changes of two JSON bodies: `+metadata`, `−legacy`, `amount → integer`. */
function bodyFields(before: string, after: string): string[] {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return [];
  }
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) || Array.isArray(b)) return [];
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(bo)) if (!(k in ao)) out.push(`+${k}`);
  for (const k of Object.keys(ao)) if (!(k in bo)) out.push(`−${k}`);
  for (const k of Object.keys(bo))
    if (k in ao && typeName(ao[k]) !== typeName(bo[k])) out.push(`${k} → ${typeName(bo[k])}`);
  return out;
}

/** What changed in the spec between two fingerprints, in short words. */
export function describeChange(base: SpecBase, next: SpecBase): string[] {
  const what: string[] = [];
  if (base.method !== next.method) what.push(`${base.method} → ${next.method}`);
  if (base.url.split('?')[0] !== next.url.split('?')[0])
    what.push(t('import.upd.url', { url: next.url.replace('{{baseUrl}}', '') }));
  const keys = (rows: [string, string][]): string[] => rows.map(([k]) => k);
  const addedQ = keys(next.params).filter((k) => !keys(base.params).includes(k));
  const removedQ = keys(base.params).filter((k) => !keys(next.params).includes(k));
  if (addedQ.length) what.push(t('import.upd.queryAdded', { keys: addedQ.join(', ') }));
  if (removedQ.length) what.push(t('import.upd.queryRemoved', { keys: removedQ.join(', ') }));
  const addedH = Object.keys(next.headers).filter((k) => !(k in base.headers));
  if (addedH.length) what.push(t('import.upd.headers', { keys: addedH.join(', ') }));
  if (base.body !== next.body) {
    const fields = bodyFields(base.body, next.body);
    what.push(fields.length ? t('import.upd.bodyFields', { fields: fields.join(', ') }) : t('import.upd.body'));
  }
  if (!what.length && !same(base.params, next.params)) what.push(t('import.upd.examples'));
  return what;
}

/**
 * Three-way merge of one request: a field the user left as imported takes the spec's new value,
 * a field they edited stays theirs. New query params and headers are added; ones the spec dropped
 * go only if the user hadn't touched them. Name, auth, scripts and settings are always the user's.
 */
export function mergeRequest(current: RequestNode, base: SpecBase, next: RequestNode): RequestNode {
  const cur = current.request;
  const nxt = next.request;
  const take = <T>(mine: T, was: T, spec: T): T => (same(mine, was) ? spec : mine);

  const nextParams = next.params ?? [];
  const params = (current.params ?? []).filter((p) => {
    const old = base.params.find(([k]) => k === p.key);
    return !old || nextParams.some((n) => n.key === p.key) || old[1] !== p.value;
  });
  for (const p of nextParams) if (!params.some((q) => q.key === p.key)) params.push(p);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cur.headers)) {
    if (k in base.headers && !(k in nxt.headers) && base.headers[k] === v) continue;
    headers[k] = v;
  }
  for (const [k, v] of Object.entries(nxt.headers)) if (!(k in headers)) headers[k] = v;

  const bodyFollows = (cur.body ?? '') === base.body;
  return {
    ...current,
    request: {
      ...cur,
      method: take(cur.method, base.method, nxt.method),
      url: take(cur.url, base.url, nxt.url),
      headers,
      ...(bodyFollows
        ? {
            body: nxt.body,
            bodyMode: nxt.bodyMode ?? cur.bodyMode,
            rawBodyFormat: nxt.rawBodyFormat ?? cur.rawBodyFormat,
          }
        : {}),
    },
    ...(params.length ? { params } : { params: undefined }),
    spec: { op: current.spec?.op ?? '', base: fingerprint(next) },
  };
}

/** Linked requests under `folder`, by spec op (the first one wins when a request was duplicated). */
function linked(folder: FolderNode): Map<string, RequestNode> {
  const out = new Map<string, RequestNode>();
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') walk(n.children);
      else if (n.spec && !out.has(n.spec.op)) out.set(n.spec.op, n);
    }
  };
  walk(folder.children);
  return out;
}

/** Which folder of the plan each request sits in (by name; null = top level). */
function folderOf(items: PlanItem[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const i of items) {
    if (i.kind === 'request') out.set(i.key, null);
    else for (const r of requestsIn((i as PlanFolder).items)) out.set(r.key, i.name);
  }
  return out;
}

/** Compare a collection made by an earlier import with the new plan. */
export function diffCollection(collection: FolderNode, plan: Plan): Diff {
  const existing = linked(collection);
  const folders = folderOf(plan.items);
  const diff: Diff = { added: [], changed: [], removed: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const req of requestsIn(plan.items)) {
    seen.add(req.link);
    const cur = existing.get(req.link);
    if (!cur) {
      const folder = folders.get(req.key) ?? null;
      const folderExists = folder === null || collection.children.some((c) => c.kind === 'folder' && c.name === folder);
      diff.added.push({ key: req.key, req, folder, folderExists });
      continue;
    }
    const base = cur.spec!.base;
    const next = fingerprint(req.node);
    if (same(base, next)) {
      diff.unchanged++;
      continue;
    }
    const merged = mergeRequest(cur, base, req.node);
    const bodyChanged = base.body !== next.body;
    diff.changed.push({
      key: req.key,
      id: cur.id,
      current: cur,
      merged,
      what: describeChange(base, next),
      ...(bodyChanged
        ? { body: { before: base.body, after: next.body, updated: (cur.request.body ?? '') === base.body } }
        : {}),
    });
  }
  for (const [op, node] of existing) if (!seen.has(op)) diff.removed.push({ key: `rm:${node.id}`, id: node.id, node });
  return diff;
}

/** Line diff for the body panel: each line marked when it isn't on the other side. */
export function bodyLines(before: string, after: string): { was: [string, boolean][]; now: [string, boolean][] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const trim = (s: string): string => s.trim().replace(/,$/, '');
  const inB = new Set(b.map(trim));
  const inA = new Set(a.map(trim));
  return { was: a.map((l) => [l, !inB.has(trim(l))]), now: b.map((l) => [l, !inA.has(trim(l))]) };
}
