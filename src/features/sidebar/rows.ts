import type { TreeNode } from '$shared/model';

/** One sidebar line: a folder/request row, or the «folder is empty» note under an open empty folder. */
export type Row =
  { kind: 'node'; key: string; node: TreeNode; depth: number } | { kind: 'empty'; key: string; depth: number };

/** The tree as the lines it draws: an open folder's children follow it, a collapsed one hides them. */
export function flattenTree(nodes: TreeNode[], depth = 0, out: Row[] = []): Row[] {
  for (const n of nodes) {
    out.push({ kind: 'node', key: n.id, node: n, depth });
    if (n.kind !== 'folder' || !n.expanded) continue;
    if (n.children.length === 0) out.push({ kind: 'empty', key: n.id + '#empty', depth: depth + 1 });
    else flattenTree(n.children, depth + 1, out);
  }
  return out;
}
