import { get } from 'svelte/store';
import type { TreeNode } from '../domain/types';
import {
  workspaceLoad,
  workspacePickFolder,
  workspaceCreateFolder,
  workspaceDelete,
  workspaceRename,
  workspaceDuplicate,
  workspaceMove,
} from '../api';
import { idToRel, findNode } from '../domain/tree';
import { relinkTabPaths } from '../domain/tab';
import { tabs, collections, workspacePath, recentWorkspacePaths, ROOT } from './state';

// ---------- Recent-workspace bookkeeping ----------

export function normalizeWorkspaceRecents(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean))).slice(0, 10);
}

export function rememberWorkspacePath(path: string): void {
  const clean = path.trim();
  if (!clean) return;
  recentWorkspacePaths.update((paths) => normalizeWorkspaceRecents([clean, ...paths]));
}

// ---------- Expanded-state preservation across reloads ----------

/** Collect the expanded state of every folder, keyed by id, into `acc`. */
export function collectExpanded(nodes: TreeNode[], acc: Map<string, boolean>): void {
  for (const n of nodes) if (n.kind === 'folder') { acc.set(n.id, n.expanded); collectExpanded(n.children, acc); }
}

/** Re-apply a saved expanded-by-id map to a freshly loaded tree; unknown folders keep the loaded default. */
export function applyExpanded(nodes: TreeNode[], map: Map<string, boolean>): TreeNode[] {
  return nodes.map((n) => n.kind === 'folder'
    ? { ...n, expanded: map.has(n.id) ? map.get(n.id)! : n.expanded, children: applyExpanded(n.children, map) }
    : n);
}

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
  tabs.update((list) => list.map((t) => (t.savedPath && !findNode(loaded, t.savedPath) ? { ...t, savedPath: undefined } : t)));
}

/**
 * Run a workspace mutation, logging (but swallowing) any failure as
 * `workspace: <name> failed`. Preserves the wrapped fn's return value on
 * success and yields `undefined` on error, so callers that return a value
 * (e.g. a new node id) keep working unchanged.
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
    collections.set(tree);
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
