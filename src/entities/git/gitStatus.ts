import { methodLabel, type GitFile, type TreeNode } from '$shared/model';

/**
 * Single effective status letter for a file row:
 * untracked -> 'U'; otherwise the staged (index) change if any, else the
 * worktree change. Falls back to 'M'.
 */
export function statusLetter(f: GitFile): string {
  if (isConflict(f)) return '!';
  if (f.index === '?' || f.worktree === '?') return 'U';
  const c = (f.index !== ' ' ? f.index : f.worktree).trim();
  return c || 'M';
}

/** Unmerged after a stopped merge / cherry-pick / rebase: porcelain `UU`, `AA`, `DD`, `AU`… */
export function isConflict(f: GitFile): boolean {
  return f.index === 'U' || f.worktree === 'U' || (f.index === f.worktree && (f.index === 'A' || f.index === 'D'));
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
  if (letter === 'A' || letter === 'U') return 'var(--color-success)';
  if (letter === 'D' || letter === '!') return 'var(--color-danger)';
  if (letter === 'R') return 'var(--method-patch)';
  return 'var(--color-warning)';
}

/** What a changed file is, for a Source Control row: the request it holds (when it is still in the tree) or its file name. */
export interface FileInfo {
  name: string;
  /** Method label shown before the name ('GET', 'gRPC'…); '' for non-request files and deleted ones. */
  method: string;
  /** Parent folder name, '' at the workspace root. */
  dir: string;
}

const REQUEST_EXT = '.bonk.json';

/**
 * Describe toplevel-relative `path` using the workspace tree. `prefix` is the workspace's path inside the
 * repo (GitStatus.prefix); `find` looks a node up by its `fs:` id.
 */
export function describeFile(path: string, prefix: string, find: (id: string) => TreeNode | undefined): FileInfo {
  const rel = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const parts = rel.split('/');
  const file = parts.at(-1) ?? rel;
  const dir = parts.length > 1 ? parts[parts.length - 2] : '';
  const node = find(`fs:${rel}`);
  if (node?.kind === 'request')
    return {
      name: node.name,
      method: node.protocol === 'grpc' ? 'gRPC' : methodLabel(node.request.method),
      dir,
    };
  return { name: file.endsWith(REQUEST_EXT) ? file.slice(0, -REQUEST_EXT.length) : file, method: '', dir };
}

/** Compact age for commit/stash rows: «now», «5m», «2h», «yday», «3d», then a date. */
export function shortAgo(timeSec: number, nowMs: number): string {
  const s = Math.max(0, nowMs / 1000 - timeSec);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'yday';
  if (days < 30) return `${days}d`;
  return new Date(timeSec * 1000).toISOString().slice(0, 10);
}

/** «5 minutes ago», in the largest whole unit. */
export function relativeAgo(timeSec: number, nowMs: number): string {
  const s = Math.max(0, nowMs / 1000 - timeSec);
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 3600) return fmt.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return fmt.format(-Math.floor(s / 3600), 'hour');
  return fmt.format(-Math.floor(s / 86400), 'day');
}
