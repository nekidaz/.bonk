import type { TreeNode, FolderNode } from '$shared/model';

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

/**
 * Filter the tree by a case-insensitive substring of the node name, request
 * URL, or gRPC endpoint (the sidebar Filter box). Postman-style semantics:
 *  - a matching request is kept;
 *  - a folder whose own name matches keeps its ENTIRE subtree;
 *  - a folder with matching descendants is kept with only those descendants;
 *  - every kept folder is forced `expanded` so matches are actually visible.
 * A blank/whitespace query returns the input unchanged (no copies).
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      if (n.kind === 'folder') {
        if (n.name.toLowerCase().includes(q)) {
          out.push({ ...n, expanded: true });
          continue;
        }
        const kids = walk(n.children);
        if (kids.length > 0) out.push({ ...n, expanded: true, children: kids });
      } else {
        const hay = `${n.name}\n${n.request.url}\n${n.grpc?.endpoint ?? ''}`.toLowerCase();
        if (hay.includes(q)) out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}
