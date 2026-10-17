import { isScratchDirty, isTabDirty } from './dirty';
import { staleSavedCopies } from './savedCopies';
import { readRequests, workspace } from '$entities/workspace';
import { tabs } from '$entities/tab';
import type { Tab } from '$shared/model';

/** Ids of open request tabs with unsaved work: a saved request that no longer matches its file, or a never-saved tab with content. */
function dirtyIds(list: Tab[], root: string): Set<string> {
  const ids = new Set<string>();
  for (const t of list) {
    if (!t.savedPath) {
      if (isScratchDirty(t)) ids.add(t.id);
    } else if (t.saved && isTabDirty(t, t.saved, root)) ids.add(t.id);
  }
  return ids;
}

/** `dirtyTabIds.current.has(tabId)`: recomputed when the tabs change (`tab.saved` follows the file, see `watchSavedCopies`). */
class DirtyTabIds {
  current = $derived(dirtyIds(tabs.list, workspace.path));
}
export const dirtyTabIds = new DirtyTabIds();

/**
 * Keep each saved tab's `saved` copy in step with its file: the tree holds light nodes with the
 * file's `contentHash`, so when that moves (an own save or rename, or an edit outside the app that
 * the folder watcher picked up) the file is read again and the dirty dot follows. Lifecycle owns this.
 */
export function watchSavedCopies(): () => void {
  const reading = new Map<string, string>();
  return $effect.root(() => {
    $effect(() => {
      const root = workspace.path;
      for (const { tabId, path, hash } of staleSavedCopies(tabs.list, workspace.tree, reading)) {
        reading.set(tabId, hash);
        readRequests([path])
          .then(([saved]) => {
            if (workspace.path !== root) return;
            tabs.updateById(tabId, (t) => (t.savedPath === path ? { ...t, saved } : t));
          })
          // Gone (unlinkOrphanTabs drops the link) or unreadable: the next tree change tries again.
          .catch(() => reading.delete(tabId));
      }
    });
  });
}
