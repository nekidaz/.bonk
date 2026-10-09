import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { collections, revealNode } from './index';
import { collapsedFolders, withSavedCollapse } from './workspace';
import type { TreeNode } from '../domain/types';

const req: TreeNode = {
  kind: 'request',
  id: 'fs:a/b/r.json',
  name: 'r',
  protocol: 'http',
  request: { method: 'GET', url: '', headers: {} },
};
const tree = (open: boolean): TreeNode[] => [
  {
    kind: 'folder',
    id: 'fs:a',
    name: 'a',
    expanded: open,
    children: [{ kind: 'folder', id: 'fs:a/b', name: 'b', expanded: open, children: [req] }],
  },
  { kind: 'folder', id: 'fs:ab', name: 'ab', expanded: false, children: [] },
];
const openIds = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.kind === 'folder' ? [...(n.expanded ? [n.id] : []), ...openIds(n.children)] : []));

describe('sidebar tree', () => {
  it('revealNode expands only the ancestors of the node', () => {
    collections.set(tree(false));
    revealNode(req.id);
    expect(openIds(get(collections))).toEqual(['fs:a', 'fs:a/b']);
  });

  it('withSavedCollapse re-applies the collapsed folders remembered for that workspace', () => {
    collapsedFolders['/ws'] = ['fs:a/b'];
    expect(openIds(withSavedCollapse('/ws', tree(true)))).toEqual(['fs:a']);
    expect(openIds(withSavedCollapse('/other', tree(true)))).toEqual(['fs:a', 'fs:a/b']);
  });
});
