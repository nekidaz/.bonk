import { isScratchDirty, isTabDirty } from './dirty';
import { findNode, workspace } from '$entities/workspace';
import { tabs } from '$entities/tab';
import type { Tab, TreeNode } from '$shared/model';

/** Ids of open request tabs with unsaved work: a saved request that no longer matches its file, or a never-saved tab with content. */
function dirtyIds(list: Tab[], tree: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  for (const t of list) {
    if (!t.savedPath) {
      if (isScratchDirty(t)) ids.add(t.id);
      continue;
    }
    const node = findNode(tree, t.savedPath);
    if (node?.kind === 'request' && isTabDirty(t, node)) ids.add(t.id);
  }
  return ids;
}

/** `dirtyTabIds.current.has(tabId)`: recomputed when the tabs or the workspace tree change. */
class DirtyTabIds {
  current = $derived(dirtyIds(tabs.list, workspace.tree));
}
export const dirtyTabIds = new DirtyTabIds();
