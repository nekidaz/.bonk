import { derived } from 'svelte/store';
import { isScratchDirty, isTabDirty } from '../domain/dirty';
import { findNode } from '../domain/tree';
import { collections, tabs } from './state';

/** Ids of open request tabs with unsaved work: a saved request that no longer matches its file, or a never-saved tab with content. */
export const dirtyTabIds = derived([tabs, collections], ([$tabs, $collections]) => {
  const ids = new Set<string>();
  for (const t of $tabs) {
    if (!t.savedPath) {
      if (isScratchDirty(t)) ids.add(t.id);
      continue;
    }
    const node = findNode($collections, t.savedPath);
    if (node?.kind === 'request' && isTabDirty(t, node)) ids.add(t.id);
  }
  return ids;
});
