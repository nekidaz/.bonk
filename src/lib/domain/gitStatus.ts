import type { GitFile } from './types';

/**
 * Single effective status letter for a file row:
 * untracked -> 'U'; otherwise the staged (index) change if any, else the
 * worktree change. Falls back to 'M'.
 */
export function statusLetter(f: GitFile): string {
  if (f.index === '?' || f.worktree === '?') return 'U';
  const c = (f.index !== ' ' ? f.index : f.worktree).trim();
  return c || 'M';
}

/** Map of repo-relative path -> effective status letter. */
export function statusByPath(files: GitFile[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) m.set(f.path, statusLetter(f));
  return m;
}

/**
 * Number of changed files at or under `folderRel` (repo-relative, no trailing
 * slash). `''` is the repo root and counts every file.
 */
export function folderChangeCount(folderRel: string, files: GitFile[]): number {
  if (folderRel === '') return files.length;
  const prefix = `${folderRel}/`;
  return files.filter((f) => f.path === folderRel || f.path.startsWith(prefix)).length;
}

/** CSS color for a status letter, matching the Git panel badge palette. */
export function statusColor(letter: string): string {
  if (letter === 'A' || letter === 'U') return 'var(--green)';
  if (letter === 'D') return 'var(--red)';
  if (letter === 'R') return 'var(--purple)';
  return 'var(--orange)';
}
