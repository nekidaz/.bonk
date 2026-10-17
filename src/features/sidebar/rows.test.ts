import { describe, expect, it } from 'vitest';
import { flattenTree } from './rows';
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
});
