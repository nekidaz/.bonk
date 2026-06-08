import type { TreeNode, FolderNode } from './types';

export function idToRel(id: string): string {
  return id.startsWith('fs:') ? id.slice(3) : id;
}

export function relToParts(rel: string): string[] {
  return rel.length ? rel.split('/') : [];
}

/** Parent folder id of a node id, or undefined if it's at the workspace root. */
export function parentId(id: string): string | undefined {
  const rel = idToRel(id);
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? undefined : 'fs:' + rel.slice(0, slash);
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === 'folder') {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function findParent(nodes: TreeNode[], id: string, parent?: FolderNode): FolderNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return parent;
    if (n.kind === 'folder') {
      const hit = findParent(n.children, id, n);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}
