import { get } from 'svelte/store';
import type { AuthConfig, TreeNode } from '../domain/types';
import {
  workspaceLoad,
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
} from '../api';
import { idToRel, findNode, parentId } from '../domain/tree';
import { relinkTabPaths } from '../domain/tab';
import { tabs, activeTabId, collections, workspacePath, recentWorkspacePaths, ROOT } from './state';

// ---------- Recent-workspace bookkeeping ----------

/** @internal — used within stores/; not re-exported by the barrel. */
export function normalizeWorkspaceRecents(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean))).slice(0, 10);
}

/** @internal — used within stores/; not re-exported by the barrel. */
export function rememberWorkspacePath(path: string): void {
  const clean = path.trim();
  if (!clean) return;
  recentWorkspacePaths.update((paths) => normalizeWorkspaceRecents([clean, ...paths]));
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

/** Collapsed folder ids per workspace root, persisted so the tree reopens as left. @internal */
export const collapsedFolders: Record<string, string[]> = {};

/** Re-apply workspace `root`'s remembered collapsed folders to a freshly loaded tree. @internal */
export function withSavedCollapse(root: string, tree: TreeNode[]): TreeNode[] {
  return applyExpanded(tree, new Map((collapsedFolders[root] ?? []).map((id) => [id, false])));
}

/** @internal — used within stores/; not re-exported by the barrel. */
export async function reloadWorkspace(): Promise<void> {
  const path = get(workspacePath);
  if (!path) return;
  // The Rust `load` always returns folders expanded:true. Preserve the user's
  // current collapse state across the reload instead of re-expanding everything.
  const tree = await workspaceLoad(path);
  const expanded = new Map<string, boolean>();
  collectExpanded(get(collections), expanded);
  collections.set(applyExpanded(tree, expanded));
  // Defensive: a tab whose savedPath no longer resolves to a real node would, on
  // the next Save, create a duplicate file instead of overwriting. Per-mutation
  // remaps run before this, so validly-relinked tabs keep their path; clear only
  // genuinely-orphaned links so the next save prompts/creates rather than duplicates.
  const loaded = get(collections);
  tabs.update((list) =>
    list.map((t) => (t.savedPath && !findNode(loaded, t.savedPath) ? { ...t, savedPath: undefined } : t)),
  );
}

/**
 * Run a workspace mutation, logging (but swallowing) any failure as
 * `workspace: <name> failed`. Preserves the wrapped fn's return value on
 * success and yields `undefined` on error, so callers that return a value
 * (e.g. a new node id) keep working unchanged.
 * @internal — used within stores/; not re-exported by the barrel.
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
    const previous = get(workspacePath);
    const tree = await workspaceLoad(clean);
    workspacePath.set(clean);
    collections.set(withSavedCollapse(clean, tree));
    rememberWorkspacePath(clean);
    if (previous && previous !== clean) {
      // savedPath is relative to the old workspace root. Keeping it after a root
      // switch risks overwriting a same-named request in the new workspace.
      tabs.update((list) => list.map((t) => (t.savedPath ? { ...t, savedPath: undefined } : t)));
    }
    return true;
  });
  if (!switched) {
    recentWorkspacePaths.update((paths) => paths.filter((p) => p !== clean));
  }
}

/** Rename the workspace folder on disk, then switch to the new path (recents follow). */
export async function renameWorkspaceFolder(name: string): Promise<void> {
  const root = get(workspacePath);
  if (!root || !name.trim()) return;
  const next = await workspaceRenameRoot(root, name);
  recentWorkspacePaths.update((paths) => paths.filter((p) => p !== root));
  await switchWorkspace(next);
}

/** Move the workspace folder to the OS trash and close the tabs linked to it. */
export async function deleteWorkspace(): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await workspaceTrash(root);
  tabs.update((list) => list.filter((t) => !t.savedPath));
  const open = get(tabs);
  if (!open.some((t) => t.id === get(activeTabId))) activeTabId.set(open[0]?.id ?? '');
  recentWorkspacePaths.update((paths) => paths.filter((p) => p !== root));
  workspacePath.set('');
  collections.set([]);
}

// ---------- Tree mutations ----------

export async function addFolder(parentFolderId?: string, name = 'New Folder'): Promise<string | undefined> {
  let root = get(workspacePath);
  if (!root) {
    // No workspace open yet — prompt the user to pick one, then create in it.
    await openWorkspaceFolder();
    root = get(workspacePath);
    if (!root) return undefined; // user cancelled the picker
  }
  return runWorkspaceOp('addFolder', async () => {
    const newId = await workspaceCreateFolder(root, parentFolderId ? idToRel(parentFolderId) : ROOT, name);
    await reloadWorkspace();
    return newId;
  });
}

/** Persist a folder's collection-level auth (null clears it); requests set to inherit pick it up. */
export async function saveFolderAuth(folderId: string, auth: AuthConfig | null): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('saveFolderAuth', async () => {
    await workspaceSaveFolderAuth(root, idToRel(folderId), auth);
    await reloadWorkspace();
  });
}

export async function removeNode(id: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('removeNode', async () => {
    await workspaceDelete(root, id);
    // Clear savedPath on the deleted node and anything nested under it: an
    // orphaned link would, on the next Save, create a duplicate file.
    tabs.update((list) => relinkTabPaths(list, id, undefined));
    await reloadWorkspace();
  });
}

export async function renameNode(id: string, name: string): Promise<void> {
  const root = get(workspacePath);
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
    await reloadWorkspace();
  });
}

export async function duplicateNode(id: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('duplicateNode', async () => {
    await workspaceDuplicate(root, id);
    await reloadWorkspace();
  });
}

export async function moveNode(id: string, destFolderId?: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('moveNode', async () => {
    const newId = await workspaceMove(root, id, destFolderId ? idToRel(destFolderId) : ROOT);
    tabs.update((list) => relinkTabPaths(list, id, newId));
    await reloadWorkspace();
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
  const root = get(workspacePath);
  if (!root || id === at?.id) return undefined;
  const name = findNode(get(collections), id)?.name;
  return runWorkspaceOp('dropNode', async () => {
    let newId = copy ? await workspaceDuplicate(root, id) : id;
    if (parentId(newId) !== dest) {
      const moved = await workspaceMove(root, newId, dest ? idToRel(dest) : ROOT);
      if (!copy) tabs.update((list) => relinkTabPaths(list, id, moved));
      // A copy in another folder keeps the original name (the backend suffixes it if taken).
      newId = copy && name ? await workspaceRename(root, moved, name) : moved;
    }
    if (at) {
      const folder = dest ? findNode(get(collections), dest) : undefined;
      const ids = (folder?.kind === 'folder' ? folder.children : get(collections))
        .map((n) => n.id)
        .filter((x) => copy || x !== id);
      ids.splice(ids.indexOf(at.id) + (at.after ? 1 : 0), 0, newId);
      await workspaceReorder(root, dest ? idToRel(dest) : ROOT, ids.map(baseName));
    }
    await reloadWorkspace();
    return newId;
  });
}

/** Undo a `dropNode`: a copy is deleted; a moved node goes back to `parent` with its old sibling order `ids`. */
export async function undoDrop(newId: string, copy: boolean, parent: string | undefined, ids: string[]): Promise<void> {
  const root = get(workspacePath);
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
    await reloadWorkspace();
  });
}

/** Expand every folder on the path to node `id`, so the tree can show it. */
export function revealNode(id: string): void {
  const expandTo = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) =>
      n.kind === 'folder' && id.startsWith(n.id + '/') ? { ...n, expanded: true, children: expandTo(n.children) } : n,
    );
  collections.update(expandTo);
}

export function toggleFolder(id: string): void {
  collections.update((tree) => toggleIn(tree, id));
}
function toggleIn(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== 'folder') return n;
    if (n.id === id) return { ...n, expanded: !n.expanded };
    return { ...n, children: toggleIn(n.children, id) };
  });
}
