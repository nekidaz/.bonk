import type { TreeNode } from '$shared/model';

/** One sidebar line: a folder/request row, or the «folder is empty» note under an open empty folder. */
export type Row =
  { kind: 'node'; key: string; node: TreeNode; depth: number } | { kind: 'empty'; key: string; depth: number };

/** Distance from one line's top to the next one's (height + gap), per kind of line. */
export type Pitch = Record<Row['kind'], number>;

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

/** Top of every row, plus the total height as the last entry (rows.length + 1 numbers). */
export function rowOffsets(rows: Row[], pitch: Pitch): number[] {
  const offsets = [0];
  for (const r of rows) offsets.push(offsets[offsets.length - 1] + pitch[r.kind]);
  return offsets;
}

/** First index i with offsets[i] > y (binary search; offsets ascend). */
function after(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Rows [start, end) that overlap the pixel band [top, bottom]. */
export function visibleRange(offsets: number[], top: number, bottom: number): [number, number] {
  const count = offsets.length - 1;
  const start = Math.min(count, Math.max(0, after(offsets, top) - 1));
  const end = Math.min(count, Math.max(start, after(offsets, bottom)));
  return [start, end];
}

/** scrollTop that brings row i fully into a `view`-high viewport, moving as little as possible. */
export function scrollToShow(offsets: number[], i: number, scrollTop: number, view: number): number {
  const top = offsets[i];
  const bottom = offsets[i + 1];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + view) return bottom - view;
  return scrollTop;
}
