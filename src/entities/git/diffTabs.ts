import { t } from '$shared/i18n';
import type { GitDiffMode, GitTabState, Tab } from '$shared/model';
import { tabs } from '$entities/tab';

/** Focus the first git tab matching `same`, or open a new one with `git` state and `title`. */
function openGitTab(same: (g: GitTabState) => boolean, git: GitTabState, title: string): void {
  const existing = tabs.list.find((x) => x.protocol === 'git' && x.git && same(x.git));
  if (existing) {
    tabs.activeId = existing.id;
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'git',
    title,
    manualTitle: true,
    request: { method: 'DIFF', url: git.path, headers: {} },
    git,
  };
  tabs.update((list) => [...list, tab]);
  tabs.activeId = tab.id;
}

/**
 * Open (or focus) the diff tab of one file; `name` is what the tab says (the request name).
 * With `rev` it is the file as a past commit changed it.
 */
export function openGitDiffTab(path: string, mode: GitDiffMode = 'working', name?: string, rev?: string): void {
  const clean = path.trim();
  if (!clean) return;
  const label = name || clean.split('/').filter(Boolean).at(-1) || clean;
  openGitTab(
    (g) => (g.view ?? 'file') === 'file' && g.path === clean && g.rev === rev,
    { path: clean, mode, rev },
    rev ? t('git.tab.commitDiff', { name: label, rev: rev.slice(0, 7) }) : t('git.tab.diff', { name: label }),
  );
  // One tab per file: re-opening it from the other list switches its Working tree | Staged mode.
  tabs.updateById(tabs.activeId, (x) => (x.git && x.git.mode !== mode ? { ...x, git: { ...x.git, mode } } : x));
}

/** Open (or focus) the single aggregate Project Diff tab. */
export function openProjectDiffTab(): void {
  openGitTab((g) => g.view === 'project', { path: '', mode: 'working', view: 'project' }, t('git.tab.changes'));
}

/** G10: open (or focus) the tab of one stash, keyed by its commit hash (stash@{N} indexes shift). */
export function openStashTab(hash: string, message: string): void {
  openGitTab(
    (g) => g.view === 'stash' && g.path === hash,
    { path: hash, mode: 'working', view: 'stash' },
    t('git.tab.stash', { name: message }),
  );
}

/** G5: open (or focus) the commit graph, selecting `hash` when given. */
export function openGraphTab(hash?: string): void {
  openGitTab((g) => g.view === 'graph', { path: '', mode: 'working', view: 'graph' }, t('git.tab.graph'));
  if (hash) tabs.updateById(tabs.activeId, (x) => (x.git ? { ...x, git: { ...x.git, rev: hash } } : x));
}

/** G7: open (or focus) the list of conflicted files of the stopped operation. */
export function openConflictsTab(): void {
  openGitTab((g) => g.view === 'conflicts', { path: '', mode: 'working', view: 'conflicts' }, t('git.tab.conflicts'));
}

/** G8: open (or focus) the three-way merge of one conflicted file. */
export function openMergeTab(path: string, name: string): void {
  openGitTab(
    (g) => g.view === 'merge' && g.path === path,
    { path, mode: 'working', view: 'merge' },
    t('git.tab.merge', { name }),
  );
}

/** G4b·E: open (or focus) the commit-message editor tab. */
export function openCommitEditorTab(): void {
  openGitTab((g) => g.view === 'commit', { path: '', mode: 'working', view: 'commit' }, t('git.tab.commit'));
}
