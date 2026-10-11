import { describe, it, expect } from 'vitest';
import {
  statusLetter,
  statusByPath,
  folderChangeCount,
  statusColor,
  describeFile,
  relativeAgo,
  shortAgo,
} from './gitStatus';
import type { GitFile, TreeNode } from '$shared/model';
import { findNode } from '$entities/workspace';

const f = (path: string, index: string, worktree: string): GitFile => ({ path, index, worktree });

describe('gitStatus helpers', () => {
  it('derives a single effective letter per file', () => {
    expect(statusLetter(f('a', '?', '?'))).toBe('U'); // untracked
    expect(statusLetter(f('b', 'A', ' '))).toBe('A'); // staged add
    expect(statusLetter(f('c', ' ', 'M'))).toBe('M'); // worktree modify
    expect(statusLetter(f('d', 'M', 'M'))).toBe('M'); // staged wins when both
    expect(statusLetter(f('e', 'D', ' '))).toBe('D');
    expect(statusLetter(f('g', 'R', ' '))).toBe('R');
    expect(statusLetter(f('h', 'A', 'M'))).toBe('A'); // divergent: staged index wins over worktree
    expect(statusLetter(f('i', 'U', 'U'))).toBe('!'); // unmerged after a stopped cherry-pick
    expect(statusLetter(f('j', 'A', 'A'))).toBe('!'); // both added
  });

  it('maps paths to letters', () => {
    const m = statusByPath([f('x/a', 'M', ' '), f('y/b', '?', '?')]);
    expect(m.get('x/a')).toBe('M');
    expect(m.get('y/b')).toBe('U');
    expect(m.get('missing')).toBeUndefined();
  });

  it('counts changed descendants of a folder by path prefix', () => {
    const files = [
      f('api/a', 'M', ' '),
      f('api/sub/b', '?', '?'),
      f('other/c', 'M', ' '),
      f('apiTwo/c', 'M', ' '), // confusable sibling: must NOT match the 'api' prefix
    ];
    expect(folderChangeCount('api', files)).toBe(2); // api/a + api/sub/b, excludes apiTwo/c
    expect(folderChangeCount('api/sub', files)).toBe(1);
    expect(folderChangeCount('other', files)).toBe(1);
    expect(folderChangeCount('apiTwo', files)).toBe(1); // the sibling counts under its own folder
    expect(folderChangeCount('', files)).toBe(4); // root counts everything
  });

  it('looks up by prefix-mapped key when the workspace is a repo subdir', () => {
    // Subdir workspace: status paths are toplevel-relative ("collections/..."),
    // node ids are workspace-relative ("a.bonk.json"). The Sidebar maps a node
    // id to its status key as `prefix + wsRel`.
    const files = [f('collections/a.bonk.json', 'M', ' '), f('collections/sub/b.bonk.json', '?', '?')];
    const prefix = 'collections/';
    const m = statusByPath(files);
    // Workspace-relative ids resolve once prefixed.
    expect(m.get(prefix + 'a.bonk.json')).toBe('M');
    expect(m.get(prefix + 'sub/b.bonk.json')).toBe('U');
    // Folder count uses the prefixed, trailing-slash-free folder path.
    expect(folderChangeCount(prefix + 'sub', files)).toBe(1);
    expect(folderChangeCount(prefix.replace(/\/$/, ''), files)).toBe(2); // whole subdir
    // Empty prefix (workspace == toplevel) is the identity mapping.
    expect(statusByPath([f('a.bonk.json', 'M', ' ')]).get('' + 'a.bonk.json')).toBe('M');
  });

  it('maps a letter to a CSS var color', () => {
    expect(statusColor('A')).toBe('var(--color-success)');
    expect(statusColor('U')).toBe('var(--color-success)');
    expect(statusColor('D')).toBe('var(--color-danger)');
    expect(statusColor('R')).toBe('var(--method-patch)');
    expect(statusColor('M')).toBe('var(--color-warning)');
    expect(statusColor('Z')).toBe('var(--color-warning)'); // unknown letter falls back to warning
  });
});

describe('describeFile', () => {
  const tree: TreeNode[] = [
    {
      kind: 'folder',
      id: 'fs:payments',
      name: 'Payments API',
      expanded: true,
      children: [
        {
          kind: 'request',
          id: 'fs:payments/list.bonk.json',
          name: 'List payments',
          protocol: 'http',
          request: { method: 'GET', url: '', headers: {} },
        } as TreeNode,
      ],
    } as TreeNode,
  ];
  const find = (id: string) => findNode(tree, id);

  it('uses the request name and method when the file is in the tree', () => {
    expect(describeFile('api/payments/list.bonk.json', 'api/', find)).toEqual({
      name: 'List payments',
      method: 'GET',
      dir: 'payments',
    });
  });

  it('falls back to the file name for deleted or non-request files', () => {
    expect(describeFile('webhooks/old-webhook.bonk.json', '', find)).toEqual({
      name: 'old-webhook',
      method: '',
      dir: 'webhooks',
    });
    expect(describeFile('README.md', '', find)).toEqual({ name: 'README.md', method: '', dir: '' });
  });
});

describe('shortAgo', () => {
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const ago = (s: number) => now / 1000 - s;
  it('steps from minutes to dates', () => {
    expect(shortAgo(ago(10), now, 'en')).toBe('now');
    expect(shortAgo(ago(300), now, 'ru')).toBe('5м');
    expect(shortAgo(ago(7200), now, 'en')).toBe('2h');
    expect(shortAgo(ago(90000), now, 'ru')).toBe('вчера');
    expect(shortAgo(ago(3 * 86400), now, 'en')).toBe('3d');
    expect(shortAgo(ago(40 * 86400), now, 'en')).toBe('2026-09-01');
  });

  it('says a longer age in the largest whole unit', () => {
    expect(relativeAgo(ago(300), now, 'en')).toBe('5 minutes ago');
    expect(relativeAgo(ago(7200), now, 'ru')).toBe('2 часа назад');
    expect(relativeAgo(ago(3 * 86400), now, 'en')).toBe('3 days ago');
  });
});
