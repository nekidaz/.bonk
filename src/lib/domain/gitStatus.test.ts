import { describe, it, expect } from 'vitest';
import { statusLetter, statusByPath, folderChangeCount, statusColor } from './gitStatus';
import type { GitFile } from './types';

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
    expect(statusColor('A')).toBe('var(--green)');
    expect(statusColor('U')).toBe('var(--green)');
    expect(statusColor('D')).toBe('var(--red)');
    expect(statusColor('R')).toBe('var(--purple)');
    expect(statusColor('M')).toBe('var(--orange)');
    expect(statusColor('Z')).toBe('var(--orange)'); // unknown letter falls back to orange
  });
});
