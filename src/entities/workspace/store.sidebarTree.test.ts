import { describe, expect, it } from 'vitest';
import { revealNode, expandedFolders, legacyCollapsedFolders, withSavedExpanded, workspace } from './store.svelte';
import type { TreeNode } from '$shared/model';

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
    workspace.tree = tree(false);
    revealNode(req.id);
    expect(openIds(workspace.tree)).toEqual(['fs:a', 'fs:a/b']);
  });

  it('withSavedExpanded re-opens the folders remembered for that workspace', () => {
    expandedFolders['/ws'] = ['fs:a'];
    expect(openIds(withSavedExpanded('/ws', tree(false)))).toEqual(['fs:a']);
    expect(openIds(withSavedExpanded('/other', tree(false)))).toEqual([]);
  });

  it('withSavedExpanded migrates the old collapsed-folders state until the new one exists', () => {
    legacyCollapsedFolders['/old'] = ['fs:a/b'];
    expect(openIds(withSavedExpanded('/old', tree(false)))).toEqual(['fs:a', 'fs:ab']);
    expandedFolders['/old'] = [];
    expect(openIds(withSavedExpanded('/old', tree(false)))).toEqual([]);
  });
});
