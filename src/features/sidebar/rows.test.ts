import { describe, expect, it } from 'vitest';
import { flattenTree, rowOffsets, scrollToShow, visibleRange } from './rows';
import type { TreeNode } from '$shared/model';

const req = (id: string): TreeNode => ({
  kind: 'request',
  id,
  name: id,
  protocol: 'http',
  request: { method: 'GET', url: '', headers: {} },
});
const tree: TreeNode[] = [
  {
    kind: 'folder',
    id: 'fs:a',
    name: 'a',
    expanded: true,
    children: [req('fs:a/r1'), { kind: 'folder', id: 'fs:a/empty', name: 'empty', expanded: true, children: [] }],
  },
  { kind: 'folder', id: 'fs:closed', name: 'closed', expanded: false, children: [req('fs:closed/r2')] },
  req('fs:r3'),
];

describe('sidebar rows', () => {
  it('flattens open folders in order, hides closed ones, notes empty ones', () => {
    expect(flattenTree(tree).map((r) => [r.key, r.depth])).toEqual([
      ['fs:a', 0],
      ['fs:a/r1', 1],
      ['fs:a/empty', 1],
      ['fs:a/empty#empty', 2],
      ['fs:closed', 0],
      ['fs:r3', 0],
    ]);
  });

  it('finds the rows a pixel band overlaps and scrolls the least to show a row', () => {
    const rows = flattenTree(tree);
    const offsets = rowOffsets(rows, { node: 10, empty: 25 });
    expect(offsets).toEqual([0, 10, 20, 30, 55, 65, 75]);
    expect(visibleRange(offsets, 0, 15)).toEqual([0, 2]);
    expect(visibleRange(offsets, 35, 60)).toEqual([3, 5]);
    expect(visibleRange(offsets, -100, 1000)).toEqual([0, 6]);
    expect(visibleRange([0], 0, 100)).toEqual([0, 0]);
    expect(scrollToShow(offsets, 5, 0, 30)).toBe(45); // below: bottom edge to the bottom
    expect(scrollToShow(offsets, 0, 40, 30)).toBe(0); // above: top edge to the top
    expect(scrollToShow(offsets, 4, 40, 30)).toBe(40); // already visible
  });
});
