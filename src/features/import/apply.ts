// Writing an import: the collection folder with its auth and source, the requests with their spec
// links, the environments (IM4 → IM7); and applying an update from the spec (IM8).
import { addEnvironment, environments, setEnvVars } from '$entities/environment';
import { idToRel, openWorkspaceFolder, parentId, refreshDirs, revealNode, ROOT, workspace } from '$entities/workspace';
import {
  workspaceCreateFolder,
  workspaceImportCollection,
  workspaceDelete,
  workspaceSaveFolderScripts,
  workspaceSaveFolderSource,
  workspaceSaveRequest,
} from '$shared/ipc';
import type { FolderNode, ImportSource, RequestNode, TreeNode } from '$shared/model';
import type { EnvRow, EnvTarget, Plan, PlanItem, PlanRequest } from './plan';
import { fingerprint, type Diff } from './reimport';

/** The open workspace's root, asking for a folder when none is open; null when the user cancels. */
async function workspaceRoot(): Promise<string | null> {
  if (!workspace.path) await openWorkspaceFolder();
  return workspace.path || null;
}

/** Put each row's variables where its target says; returns the environment names created and updated. */
export function applyEnvs(rows: EnvRow[], targets: EnvTarget[]): { created: string[]; updated: string[] } {
  const prevActive = environments.activeId;
  const created: { id: string; name: string }[] = [];
  const updated: string[] = [];
  rows.forEach((row, i) => {
    const target = targets[i];
    if (!target || target.kind === 'skip') return;
    if (target.kind === 'new') {
      const id = addEnvironment(target.name);
      setEnvVars(id, row.vars);
      created.push({ id, name: environments.list.find((e) => e.id === id)?.name ?? target.name });
      return;
    }
    const env = environments.list.find((e) => e.id === target.id);
    if (!env) return;
    const vars = [...env.vars];
    for (const v of row.vars) {
      const at = vars.findIndex((x) => x.key === v.key);
      if (at >= 0) vars[at] = { ...vars[at], value: v.value, enabled: true };
      else vars.push(v);
    }
    setEnvVars(env.id, vars);
    updated.push(env.name);
  });
  // addEnvironment activates what it creates. An import must not steal the user's active environment
  // (their {{vars}} would stop resolving); with none active, the first new one is a sensible default.
  environments.activeId = prevActive ?? created[0]?.id ?? null;
  return { created: created.map((c) => c.name), updated };
}

const linkOf = (r: PlanRequest): RequestNode['spec'] => ({ op: r.link, base: fingerprint(r.node) });

export interface ImportResult {
  name: string;
  requests: number;
  first?: RequestNode;
  envs: { created: string[]; updated: string[] };
}

/**
 * Create the collection `name` with the already pruned `items`. `source` (file or link) is saved
 * on the collection and every request gets its spec link, so the import can be repeated (IM8).
 */
export async function importPlan(p: {
  name: string;
  items: PlanItem[];
  collectionAuth?: RequestNode['request']['auth'];
  collectionScripts?: Plan['collectionScripts'];
  envRows: EnvRow[];
  targets: EnvTarget[];
  source?: ImportSource;
}): Promise<ImportResult | null> {
  const root = await workspaceRoot();
  if (!root) return null;
  const nodes = (items: PlanItem[]): TreeNode[] =>
    items.map((item) =>
      item.kind === 'folder'
        ? {
            kind: 'folder',
            id: '',
            name: item.name,
            expanded: false,
            preRequestScript: item.preRequestScript,
            testScript: item.testScript,
            children: nodes(item.items),
          }
        : p.source
          ? { ...item.node, spec: linkOf(item) }
          : item.node,
    );
  const collectionId = await workspaceImportCollection(root, {
    name: p.name,
    children: nodes(p.items),
    auth: p.collectionAuth,
    source: p.source,
    ...p.collectionScripts,
  });
  const count = (items: PlanItem[]): number =>
    items.reduce((n, item) => n + (item.kind === 'folder' ? count(item.items) : 1), 0);
  const requests = count(p.items);
  const envs = applyEnvs(p.envRows, p.targets);
  await refreshDirs(ROOT);
  const firstRequest = (nodes: TreeNode[]): RequestNode | undefined => {
    for (const node of nodes) {
      if (node.kind === 'request') return node;
      const found = firstRequest(node.children);
      if (found) return found;
    }
  };
  const collection = workspace.tree.find((n) => n.id === collectionId);
  const first = collection?.kind === 'folder' ? firstRequest(collection.children) : undefined;
  revealNode(collectionId);
  return { name: workspace.tree.find((n) => n.id === collectionId)?.name ?? p.name, requests, first, envs };
}

/**
 * Apply an update from the spec to `collection`: add the new requests (into existing or new folders),
 * save the merged changed ones, delete the removed ones the user chose to drop. `skip` = unchecked keys.
 */
export async function applyUpdate(
  collection: FolderNode,
  diff: Diff,
  skip: ReadonlySet<string>,
  drop: ReadonlySet<string>,
  source: ImportSource,
): Promise<number> {
  const root = await workspaceRoot();
  if (!root) return 0;
  let n = 0;
  // Folders whose files change: refreshDirs keeps already loaded subfolders as they were.
  const touched = new Set<string>([collection.id]);
  const folders = new Map(collection.children.flatMap((c) => (c.kind === 'folder' ? [[c.name, c.id] as const] : [])));
  for (const a of diff.added) {
    if (skip.has(a.key)) continue;
    let dir = collection.id;
    if (a.folder !== null && !folders.has(a.folder)) {
      // A folder the update creates gets the export's scripts; an existing one keeps its own (like auth).
      dir = await workspaceCreateFolder(root, idToRel(collection.id), a.folder);
      folders.set(a.folder, dir);
      if (a.folderScripts)
        await workspaceSaveFolderScripts(root, idToRel(dir), a.folderScripts.pre, a.folderScripts.test);
    } else if (a.folder !== null) dir = folders.get(a.folder)!;
    await workspaceSaveRequest(root, idToRel(dir), null, { ...a.req.node, spec: linkOf(a.req) });
    touched.add(dir);
    n++;
  }
  for (const c of diff.changed) {
    if (skip.has(c.key)) continue;
    const dir = parentId(c.id) ?? ROOT;
    await workspaceSaveRequest(root, idToRel(dir), idToRel(c.id), c.merged);
    touched.add(dir);
    n++;
  }
  for (const r of diff.removed) {
    if (!drop.has(r.key) || skip.has(r.key)) continue;
    await workspaceDelete(root, idToRel(r.id));
    touched.add(parentId(r.id) ?? ROOT);
    n++;
  }
  await workspaceSaveFolderSource(root, idToRel(collection.id), source);
  await refreshDirs(parentId(collection.id) ?? ROOT, ...touched);
  revealNode(collection.id);
  return n;
}
