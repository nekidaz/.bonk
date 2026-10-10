// The import preview (IM4): what will be created — a tree with checkboxes, environment rows,
// collection auth — built from a parsed source and the user's options. Nothing is written here.
import type { ImportedPostmanItem, ParsedPostmanCollection, ParsedSpec } from '$entities/workspace';
import type { AuthConfig, Environment, RequestNode, VarRow } from '$shared/model';
import { tp } from '$shared/i18n';

export interface PlanRequest {
  kind: 'request';
  /** Unique within the plan: the checkbox identity. */
  key: string;
  /** Identity across re-imports: operationId, else `METHOD path`. */
  link: string;
  node: RequestNode;
  /** Dim text after the name: path, query, merge count. */
  hint: string;
  /** Imported with a warning (IM5). */
  warn?: boolean;
  /** The body schema offered this many variants; the first was used. */
  variants?: number;
}

export interface PlanFolder {
  kind: 'folder';
  key: string;
  name: string;
  /** A HAR domain folder (globe icon). */
  domain?: boolean;
  /** Recorded entries, when filters left fewer (or none) in `items`. */
  total?: number;
  items: PlanItem[];
}

export type PlanItem = PlanFolder | PlanRequest;

/** Variables that go to an environment: one per server (OpenAPI), the collection's (Postman), the HAR origin. */
export interface EnvRow {
  key: string;
  label: string;
  vars: VarRow[];
  /** Name for a new environment. */
  suggest: string;
  /** Prefer the active environment (HAR: «в активном окружении»). */
  active?: boolean;
}

export interface Plan {
  title: string;
  items: PlanItem[];
  envRows: EnvRow[];
  /** Goes on the collection folder; requests inherit it. */
  collectionAuth?: AuthConfig;
}

export type Grouping = 'tags' | 'paths' | 'flat';

export type EnvTarget = { kind: 'skip' } | { kind: 'env'; id: string } | { kind: 'new'; name: string };

/** First path segment that isn't a parameter: `/payments/{id}` → `payments`. */
function pathGroup(path: string): string | null {
  return path.split('/').find((s) => s && !s.startsWith('{')) ?? null;
}

/** An OpenAPI spec as a plan: folders by tag, by path or none. */
export function openApiPlan(spec: ParsedSpec, group: Grouping): Plan {
  const folders = new Map<string | null, PlanRequest[]>();
  for (const op of spec.ops) {
    const name = group === 'tags' ? op.tag : group === 'paths' ? pathGroup(op.path) : null;
    const req: PlanRequest = {
      kind: 'request',
      key: op.key,
      link: op.key,
      node: op.node,
      hint: op.node.request.url.replace('{{baseUrl}}', '') || '/',
      ...(op.missingRef ? { warn: true } : {}),
      ...(op.variants ? { variants: op.variants } : {}),
    };
    folders.set(name, [...(folders.get(name) ?? []), req]);
  }
  const items: PlanItem[] = [];
  for (const [name, reqs] of folders) {
    if (name === null) items.push(...reqs);
    else items.push({ kind: 'folder', key: `f:${name}`, name, items: reqs });
  }
  const host = (url: string): string => url.replace(/^\w+:\/\//, '').split('/')[0];
  return {
    title: spec.title,
    items,
    envRows: spec.servers.map((s) => ({
      key: s.url,
      label: s.url,
      vars: [{ key: 'baseUrl', value: s.url, enabled: true }],
      suggest: s.description || (spec.servers.length === 1 ? spec.title : host(s.url)),
    })),
    ...(spec.collectionAuth ? { collectionAuth: spec.collectionAuth.auth } : {}),
  };
}

/** Path of a request URL for `METHOD path` links: no origin, no `{{baseUrl}}`, no query. */
function urlPath(url: string): string {
  return url.replace(/^(\{\{[^}]+\}\}|\w+:\/\/[^/?#]*)/, '').split(/[?#]/)[0] || '/';
}

/** A Postman / Insomnia / cURL collection as a plan: its own folder tree. */
export function collectionPlan(c: ParsedPostmanCollection): Plan {
  const walk = (items: ImportedPostmanItem[], prefix: string): PlanItem[] =>
    items.map((item, i): PlanItem => {
      const key = `${prefix}${i}`;
      if (item.kind === 'folder') return { kind: 'folder', key, name: item.name, items: walk(item.items, `${key}/`) };
      const path = urlPath(item.node.request.url);
      return { kind: 'request', key, link: `${item.node.request.method} ${path}`, node: item.node, hint: path };
    });
  const n = c.variables.length;
  return {
    title: c.title,
    items: walk(c.items, 'p:'),
    envRows: n
      ? [
          {
            key: 'vars',
            label: `${n} ${tp(n, ['переменная коллекции', 'переменные коллекции', 'переменных коллекции'], ['collection variable', 'collection variables'])}`,
            vars: c.variables,
            suggest: c.title,
          },
        ]
      : [],
  };
}

/** Every request of a plan, depth-first. */
export function requestsIn(items: PlanItem[]): PlanRequest[] {
  return items.flatMap((i) => (i.kind === 'folder' ? requestsIn(i.items) : [i]));
}

/** The plan without unchecked requests and the folders that leaves empty. */
export function pruneExcluded(items: PlanItem[], excluded: ReadonlySet<string>): PlanItem[] {
  return items.flatMap((i): PlanItem[] => {
    if (i.kind === 'request') return excluded.has(i.key) ? [] : [i];
    const kept = pruneExcluded(i.items, excluded);
    return kept.length ? [{ ...i, items: kept }] : [];
  });
}

/** Folders and requests the import will create. */
export function countPlan(items: PlanItem[]): { folders: number; requests: number } {
  let folders = 0;
  let requests = 0;
  for (const i of items) {
    if (i.kind === 'request') requests++;
    else {
      const sub = countPlan(i.items);
      folders += 1 + sub.folders;
      requests += sub.requests;
    }
  }
  return { folders, requests };
}

const baseUrlOf = (row: EnvRow): string | undefined => row.vars.find((v) => v.key === 'baseUrl')?.value;

/**
 * Where each row's variables go by default: the active environment for a HAR origin, an environment
 * that already points `baseUrl` at the same address, one with the suggested name, else a new one.
 */
export function defaultTargets(rows: EnvRow[], envs: Environment[], activeId: string | null): EnvTarget[] {
  const taken = new Set(envs.map((e) => e.name.toLowerCase()));
  return rows.map((row) => {
    if (row.active && activeId) return { kind: 'env', id: activeId };
    const url = baseUrlOf(row);
    const same =
      (url && envs.find((e) => e.vars.some((v) => v.key === 'baseUrl' && v.value === url))) ||
      envs.find((e) => row.suggest && e.name.toLowerCase() === row.suggest.toLowerCase());
    if (same) return { kind: 'env', id: same.id };
    let name = row.suggest || 'Imported';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${row.suggest || 'Imported'} ${n}`;
    taken.add(name.toLowerCase());
    return { kind: 'new', name };
  });
}
