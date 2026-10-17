import { describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '$shared/model';

const req = (id: string): TreeNode => ({
  kind: 'request',
  id,
  name: id,
  protocol: 'http',
  request: { method: 'GET', url: '', headers: {} },
});
const folder = (id: string, children: TreeNode[], expanded = false): TreeNode => ({
  kind: 'folder',
  id,
  name: id,
  expanded,
  children,
});

// The disk after `fs:A/B/y` moved up into `fs:A` (Rust returns folders collapsed).
const disk: TreeNode[] = [
  folder('fs:A', [folder('fs:A/B', []), req('fs:A/x'), req('fs:A/y')]),
  folder('fs:C', [req('fs:C/z')]),
];
const calls: { cmd: string; dir?: string; keep?: string[] }[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, a: { dir: string; keep: string[] }) => {
    if (cmd.startsWith('workspace_')) calls.push({ cmd, ...a });
    if (cmd !== 'workspace_load_children') return cmd === 'workspace_load' ? disk : undefined;
    const find = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((n) => (n.id === 'fs:' + a.dir ? [n] : n.kind === 'folder' ? find(n.children) : []));
    const kids = a.dir ? (find(disk)[0] as { children: TreeNode[] }).children : disk;
    return kids.map((n) => (n.kind === 'folder' && a.keep.includes(n.id) ? { ...n, children: [] } : n));
  }),
}));

const { refreshDirs, workspace } = await import('./store.svelte');

describe('refreshDirs', () => {
  it('re-reads only the changed folders, deepest first, and keeps the rest of the tree as is', async () => {
    const c = folder('fs:C', [req('fs:C/z')]);
    workspace.path = '/ws';
    workspace.tree = [folder('fs:A', [req('fs:A/x'), folder('fs:A/B', [req('fs:A/B/y')], true)], true), c];

    await refreshDirs('fs:A', 'fs:A/B');

    expect(calls).toEqual([
      { cmd: 'workspace_load_children', root: '/ws', dir: 'A/B', keep: [] },
      { cmd: 'workspace_load_children', root: '/ws', dir: 'A', keep: ['fs:A/B'] },
    ]);
    const [a, untouched] = workspace.tree;
    expect(untouched).toBe(c);
    expect(a).toMatchObject({ id: 'fs:A', expanded: true });
    const kids = (a as { children: TreeNode[] }).children;
    expect(kids.map((n) => n.id)).toEqual(['fs:A/B', 'fs:A/x', 'fs:A/y']);
    expect(kids[0]).toMatchObject({ expanded: true, children: [] });
  });

  it('refreshes the nearest folder still in the tree for one that is gone, not the whole workspace', async () => {
    calls.length = 0;
    workspace.path = '/ws';
    workspace.tree = [folder('fs:A', [folder('fs:A/B', [req('fs:A/B/y')], true)], true)];

    await refreshDirs('fs:A/B/gone', 'fs:A/B/gone/deeper');

    expect(calls).toEqual([{ cmd: 'workspace_load_children', root: '/ws', dir: 'A/B', keep: [] }]);
    expect((workspace.tree[0] as { children: TreeNode[] }).children[0]).toMatchObject({
      id: 'fs:A/B',
      expanded: true,
      children: [],
    });
  });
});
