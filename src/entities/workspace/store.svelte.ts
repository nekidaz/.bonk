import type { AuthConfig, HttpRequest, TreeNode } from '$shared/model';
import {
  workspaceLoad,
  workspaceLoadChildren,
  workspacePickFolder,
  workspaceCreateFolder,
  workspaceSaveFolderAuth,
  workspaceDelete,
  workspaceRename,
  workspaceDuplicate,
  workspaceMove,
  workspaceReorder,
  workspaceRenameRoot,
  workspaceTrash,
  workspaceWatch,
} from '$shared/ipc';
import { idToRel, findNode, parentId } from './tree';
import { relinkTabPaths, tabs } from '$entities/tab';
import { withEffectiveAuth } from './authInherit';

/** fs root rel path. Shared by every workspace/request operation. */
export const ROOT = '';

/** The open workspace folder (filesystem-as-truth): its path, its tree, and recently opened folders. */
class Workspace {
  /** The workspace tree as loaded from disk ([] when no folder is open). Replaced, never mutated. */
  tree = $state.raw<TreeNode[]>([]);
  /** Absolute path of the open folder; '' when none. */
  path = $state('');
  /** Recently opened folders, newest first (at most 10). */
  recent = $state.raw<string[]>([]);
  /** The node revealNode() last asked to show (a fresh object each call); the sidebar scrolls to it. */
  revealed = $state.raw<{ id: string } | undefined>(undefined);
  /** Bumped when `.bonk/` (scenarios, «ask on send» inputs) changes on disk; 0 until it first does. */
  metaRev = $state(0);
}
export const workspace = new Workspace();

/** `x` with collection auth resolved into `request.auth` (id = saved request id); use before building/previewing a send. */
export function withInheritedAuth<T extends { request: HttpRequest }>(x: T, id: string | undefined): T {
  return withEffectiveAuth(x, workspace.tree, id);
}

// ---------- Recent-workspace bookkeeping ----------

/** @internal — used within entities/workspace; not in index.ts. */
export function normalizeWorkspaceRecents(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean))).slice(0, 10);
}

/** @internal — used within entities/workspace; not in index.ts. */
export function rememberWorkspacePath(path: string): void {
  const clean = path.trim();
  if (!clean) return;
  workspace.recent = normalizeWorkspaceRecents([clean, ...workspace.recent]);
}

// ---------- Expanded-state preservation across reloads ----------

/** Collect the expanded state of every folder, keyed by id, into `acc`. @internal */
export function collectExpanded(nodes: TreeNode[], acc: Map<string, boolean>): void {
  for (const n of nodes)
    if (n.kind === 'folder') {
      acc.set(n.id, n.expanded);
      collectExpanded(n.children, acc);
    }
}

/** Re-apply a saved expanded-by-id map to a freshly loaded tree; unknown folders keep the loaded default. @internal */
export function applyExpanded(nodes: TreeNode[], map: Map<string, boolean>): TreeNode[] {
  return nodes.map((n) =>
    n.kind === 'folder'
      ? { ...n, expanded: map.has(n.id) ? map.get(n.id)! : n.expanded, children: applyExpanded(n.children, map) }
      : n,
  );
}

/** Open folder ids per workspace root, persisted so the tree reopens as left. @internal */
export const expandedFolders: Record<string, string[]> = {};

/**
 * The old `collapsedFolders` state key: collapsed folder ids per root, everything else was open.
 * Read only until that root has an `expandedFolders` entry, which the next save writes. @internal
 */
export const legacyCollapsedFolders: Record<string, string[]> = {};

/** Re-open workspace `root`'s remembered open folders in a freshly loaded (all collapsed) tree. @internal */
export function withSavedExpanded(root: string, tree: TreeNode[]): TreeNode[] {
  const legacy = expandedFolders[root] ? undefined : legacyCollapsedFolders[root];
  if (legacy) {
    const all = new Map<string, boolean>();
    collectExpanded(tree, all);
    return applyExpanded(tree, new Map([...all.keys()].map((id) => [id, !legacy.includes(id)])));
  }
  return applyExpanded(tree, new Map((expandedFolders[root] ?? []).map((id) => [id, true])));
}

/** Re-read the whole workspace from disk (keeping open folders open); refreshDirs() is the cheap path. */
export async function reloadWorkspace(): Promise<void> {
  const path = workspace.path;
  if (!path) return;
  // The Rust `load` always returns folders collapsed. Preserve the user's
  // current open folders across the reload instead of collapsing everything.
  const tree = await workspaceLoad(path);
  const expanded = new Map<string, boolean>();
  collectExpanded(workspace.tree, expanded);
  workspace.tree = applyExpanded(tree, expanded);
  unlinkOrphanTabs();
}

/**
 * Keep the tree in step with changes made outside the app (bonk MCP, git, an editor): Rust
 * watches the open folder and reports which folders changed. The app's own writes come back
 * too, and re-reading them is harmless. Lifecycle owns this watcher.
 */
export function watchWorkspaceFiles(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const root = workspace.path;
      workspaceWatch(root, (change) => {
        if (workspace.path !== root) return;
        if (change.meta) workspace.metaRev++;
        const reload = () => reloadWorkspace().catch(() => {}); // the folder itself is gone: nothing to show
        if (change.full) void reload();
        else if (change.dirs.length > 0)
          refreshDirs(...change.dirs.map((rel) => (rel ? `fs:${rel}` : ROOT))).catch(reload);
      }).catch((e) => console.warn('workspace watch:', e));
    });
  });
}

// Defensive: a tab whose savedPath no longer resolves to a real node would, on
// the next Save, create a duplicate file instead of overwriting. Per-mutation
// remaps run before this, so validly-relinked tabs keep their path; clear only
// genuinely-orphaned links so the next save prompts/creates rather than duplicates.
function unlinkOrphanTabs(): void {
  const loaded = workspace.tree;
  tabs.update((list) =>
    list.map((t) => (t.savedPath && !findNode(loaded, t.savedPath) ? { ...t, savedPath: undefined } : t)),
  );
}

let refreshing: Promise<void> = Promise.resolve();

/**
 * After a change on disk inside folders `dirs` (undefined or ROOT = the workspace root), re-read
 * just those folders instead of the whole workspace. Subfolders the tree already has keep their
 * loaded children (Rust doesn't read them); new ones load whole. Deepest first, so a parent then
 * reuses its just-refreshed child. Calls run one at a time, and each splices into the tree as it
 * is when the disk read returns (a folder toggled meanwhile stays toggled).
 */
export function refreshDirs(...dirs: (string | undefined)[]): Promise<void> {
  const run = refreshing.then(() => refreshNow(dirs));
  refreshing = run.catch(() => {});
  return run;
}

async function refreshNow(dirs: (string | undefined)[]): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  const depth = (id: string) => (id === ROOT ? 0 : idToRel(id).split('/').length);
  for (const dir of [...new Set(dirs.map((d) => d || ROOT))].sort((a, b) => depth(b) - depth(a))) {
    const before = childrenOf(workspace.tree, dir);
    if (!before) return reloadWorkspace(); // not a folder in the tree: start over
    const keep = new Set(before.filter((n) => n.kind === 'folder').map((n) => n.id));
    const fresh = await workspaceLoadChildren(root, idToRel(dir), [...keep]);
    if (workspace.path !== root) return; // another workspace was opened meanwhile
    const old = new Map((childrenOf(workspace.tree, dir) ?? []).map((n) => [n.id, n]));
    const expanded = new Map<string, boolean>();
    collectExpanded(workspace.tree, expanded);
    const children: TreeNode[] = [];
    for (const n of fresh) {
      const was = old.get(n.id);
      if (n.kind !== 'folder' || !keep.has(n.id)) children.push(...applyExpanded([n], expanded));
      else if (was?.kind === 'folder') children.push({ ...n, expanded: was.expanded, children: was.children });
      else return reloadWorkspace(); // a kept folder vanished from the tree meanwhile
    }
    workspace.tree = dir === ROOT ? children : withChildren(workspace.tree, dir, children);
  }
  unlinkOrphanTabs();
}

function childrenOf(tree: TreeNode[], dir: string): TreeNode[] | undefined {
  if (dir === ROOT) return tree;
  const n = findNode(tree, dir);
  return n?.kind === 'folder' ? n.children : undefined;
}

/** `nodes` with folder `id`'s children replaced; only the folders on the path to it are copied. */
function withChildren(nodes: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== 'folder') return n;
    if (n.id === id) return { ...n, children };
    return id.startsWith(n.id + '/') ? { ...n, children: withChildren(n.children, id, children) } : n;
  });
}

/**
 * Run a workspace mutation, logging (but swallowing) any failure as
 * `workspace: <name> failed`. Preserves the wrapped fn's return value on
 * success and yields `undefined` on error, so callers that return a value
 * (e.g. a new node id) keep working unchanged.
 * @internal — used within entities/workspace; not in index.ts.
 */
export async function runWorkspaceOp<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(`workspace: ${name} failed`, err);
    return undefined;
  }
}

// ---------- Workspace open / switch ----------

export async function openWorkspaceFolder(): Promise<void> {
  await runWorkspaceOp('openWorkspaceFolder', async () => {
    const path = await workspacePickFolder();
    if (!path) return;
    await switchWorkspace(path);
  });
}

export async function switchWorkspace(path: string): Promise<void> {
  const clean = path.trim();
  if (!clean) return;
  const switched = await runWorkspaceOp('switchWorkspace', async () => {
    const previous = workspace.path;
    const tree = await workspaceLoad(clean);
    workspace.path = clean;
    workspace.tree = withSavedExpanded(clean, tree);
    rememberWorkspacePath(clean);
    if (previous && previous !== clean) {
      // savedPath is relative to the old workspace root. Keeping it after a root
      // switch risks overwriting a same-named request in the new workspace.
      tabs.update((list) => list.map((t) => (t.savedPath ? { ...t, savedPath: undefined } : t)));
    }
    return true;
  });
  if (!switched) {
    workspace.recent = workspace.recent.filter((p) => p !== clean);
  }
}

/** Rename the workspace folder on disk, then switch to the new path (recents follow). */
export async function renameWorkspaceFolder(name: string): Promise<void> {
  const root = workspace.path;
  if (!root || !name.trim()) return;
  const next = await workspaceRenameRoot(root, name);
  workspace.recent = workspace.recent.filter((p) => p !== root);
  await switchWorkspace(next);
}

/** Move the workspace folder to the OS trash and close the tabs linked to it. */
export async function deleteWorkspace(): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await workspaceTrash(root);
  tabs.update((list) => list.filter((t) => !t.savedPath));
  const open = tabs.list;
  if (!open.some((t) => t.id === tabs.activeId)) tabs.activeId = open[0]?.id ?? '';
  workspace.recent = workspace.recent.filter((p) => p !== root);
  workspace.path = '';
  workspace.tree = [];
}

// ---------- Tree mutations ----------

export async function addFolder(parentFolderId?: string, name = 'New Folder'): Promise<string | undefined> {
  let root = workspace.path;
  if (!root) {
    // No workspace open yet — prompt the user to pick one, then create in it.
    await openWorkspaceFolder();
    root = workspace.path;
    if (!root) return undefined; // user cancelled the picker
  }
  return runWorkspaceOp('addFolder', async () => {
    const newId = await workspaceCreateFolder(root, parentFolderId ? idToRel(parentFolderId) : ROOT, name);
    await refreshDirs(parentFolderId);
    return newId;
  });
}

/** Persist a folder's collection-level auth (null clears it); requests set to inherit pick it up. */
export async function saveFolderAuth(folderId: string, auth: AuthConfig | null): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await runWorkspaceOp('saveFolderAuth', async () => {
    await workspaceSaveFolderAuth(root, idToRel(folderId), auth);
    await refreshDirs(parentId(folderId));
  });
}

export async function removeNode(id: string): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await runWorkspaceOp('removeNode', async () => {
    await workspaceDelete(root, id);
    // Clear savedPath on the deleted node and anything nested under it: an
    // orphaned link would, on the next Save, create a duplicate file.
    tabs.update((list) => relinkTabPaths(list, id, undefined));
    await refreshDirs(parentId(id));
  });
}

export async function renameNode(id: string, name: string): Promise<void> {
  const root = workspace.path;
  const clean = name.trim();
  if (!root || !clean) return;
  await runWorkspaceOp('renameNode', async () => {
    const newId = await workspaceRename(root, id, clean);
    // Remap the exact match + nested-prefix savedPaths to the new id, then mark
    // the renamed tab itself with the new title so its tab label stays in sync.
    tabs.update((list) =>
      relinkTabPaths(list, id, newId).map((t) =>
        t.savedPath === newId ? { ...t, title: clean, manualTitle: true } : t,
      ),
    );
    await refreshDirs(parentId(id));
  });
}

export async function duplicateNode(id: string): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await runWorkspaceOp('duplicateNode', async () => {
    await workspaceDuplicate(root, id);
    await refreshDirs(parentId(id));
  });
}

export async function moveNode(id: string, destFolderId?: string): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await runWorkspaceOp('moveNode', async () => {
    const newId = await workspaceMove(root, id, destFolderId ? idToRel(destFolderId) : ROOT);
    tabs.update((list) => relinkTabPaths(list, id, newId));
    await refreshDirs(parentId(id), destFolderId);
  });
}

const baseName = (id: string) => idToRel(id).split('/').pop()!;

/**
 * Drag & drop: move (or, with `copy`, duplicate) node `id` into folder `dest`
 * (undefined = root), optionally right before/after its child `at.id`.
 * Returns the resulting node id.
 */
export async function dropNode(
  id: string,
  dest: string | undefined,
  at?: { id: string; after: boolean },
  copy = false,
): Promise<string | undefined> {
  const root = workspace.path;
  if (!root || id === at?.id) return undefined;
  const name = findNode(workspace.tree, id)?.name;
  return runWorkspaceOp('dropNode', async () => {
    let newId = copy ? await workspaceDuplicate(root, id) : id;
    if (parentId(newId) !== dest) {
      const moved = await workspaceMove(root, newId, dest ? idToRel(dest) : ROOT);
      if (!copy) tabs.update((list) => relinkTabPaths(list, id, moved));
      // A copy in another folder keeps the original name (the backend suffixes it if taken).
      newId = copy && name ? await workspaceRename(root, moved, name) : moved;
    }
    if (at) {
      const folder = dest ? findNode(workspace.tree, dest) : undefined;
      const ids = (folder?.kind === 'folder' ? folder.children : workspace.tree)
        .map((n) => n.id)
        .filter((x) => copy || x !== id);
      ids.splice(ids.indexOf(at.id) + (at.after ? 1 : 0), 0, newId);
      await workspaceReorder(root, dest ? idToRel(dest) : ROOT, ids.map(baseName));
    }
    await refreshDirs(parentId(id), dest);
    return newId;
  });
}

/** Undo a `dropNode`: a copy is deleted; a moved node goes back to `parent` with its old sibling order `ids`. */
export async function undoDrop(newId: string, copy: boolean, parent: string | undefined, ids: string[]): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  await runWorkspaceOp('undoDrop', async () => {
    if (copy) {
      await workspaceDelete(root, newId);
      tabs.update((list) => relinkTabPaths(list, newId, undefined));
    } else {
      const back =
        parentId(newId) === parent ? newId : await workspaceMove(root, newId, parent ? idToRel(parent) : ROOT);
      tabs.update((list) => relinkTabPaths(list, newId, back));
      await workspaceReorder(root, parent ? idToRel(parent) : ROOT, ids.map(baseName));
    }
    await refreshDirs(parentId(newId), parent);
  });
}

/** Expand every folder on the path to node `id`, so the tree can show it. */
export function revealNode(id: string): void {
  const expandTo = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) =>
      n.kind === 'folder' && id.startsWith(n.id + '/') ? { ...n, expanded: true, children: expandTo(n.children) } : n,
    );
  workspace.tree = expandTo(workspace.tree);
  workspace.revealed = { id };
}

export function toggleFolder(id: string): void {
  workspace.tree = toggleIn(workspace.tree, id);
}
function toggleIn(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== 'folder') return n;
    if (n.id === id) return { ...n, expanded: !n.expanded };
    return { ...n, children: toggleIn(n.children, id) };
  });
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
