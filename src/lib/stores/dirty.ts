import { derived } from 'svelte/store';
import { isTabDirty } from '../domain/dirty';
import { findNode } from '../domain/tree';
import { collections, tabs } from './state';

/** Ids of open tabs backed by a saved request whose content no longer matches the file. */
export const dirtyTabIds = derived([tabs, collections], ([$tabs, $collections]) => {
  const ids = new Set<string>();
  for (const t of $tabs) {
    if (!t.savedPath) continue;
    const node = findNode($collections, t.savedPath);
    if (node?.kind === 'request' && isTabDirty(t, node)) ids.add(t.id);
  }
  return ids;
});
