import { get } from 'svelte/store';
import { t } from '$shared/i18n';
import type { GitDiffMode, Tab } from '$shared/model';
import { tabs, activeTabId } from '$entities/tab';

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function openGitDiffTab(path: string, mode: GitDiffMode = 'working'): void {
  const clean = path.trim();
  if (!clean) return;
  const existing = get(tabs).find((t) => t.protocol === 'git' && t.git?.path === clean && t.git.mode === mode);
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'git',
    title: mode === 'staged' ? t('git.tab.staged', { name: basename(clean) }) : basename(clean),
    manualTitle: true,
    request: { method: 'DIFF', url: clean, headers: {} },
    git: { path: clean, mode },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

/** Open (or focus) the single aggregate Project Diff tab. */
export function openProjectDiffTab(): void {
  const existing = get(tabs).find((t) => t.protocol === 'git' && t.git?.view === 'project');
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'git',
    title: t('git.tab.changes'),
    manualTitle: true,
    request: { method: 'DIFF', url: '', headers: {} },
    git: { path: '', mode: 'working', view: 'project' },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}
