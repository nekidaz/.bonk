import type { Tab, TreeNode } from '$shared/model';
import { findNode } from '$entities/workspace';

/** One saved tab whose file on disk no longer matches its `saved` copy. */
export interface StaleCopy {
  tabId: string;
  /** The file's tree id (`fs:…`). */
  path: string;
  /** The tree's `contentHash` of it. */
  hash: string;
}

/**
 * Saved tabs whose `saved` copy is behind the file (the tree's `contentHash` moved: an own save or
 * rename, or an edit outside the app). `reading` = tab id → hash already being read, so a file that
 * keeps changing is read once per tree state.
 */
export function staleSavedCopies(list: Tab[], tree: TreeNode[], reading: Map<string, string>): StaleCopy[] {
  const out: StaleCopy[] = [];
  for (const t of list) {
    if (!t.savedPath || (t.protocol !== 'http' && t.protocol !== 'grpc')) continue;
    const node = findNode(tree, t.savedPath);
    if (node?.kind !== 'request' || !node.contentHash) continue;
    if (t.saved?.contentHash === node.contentHash || reading.get(t.id) === node.contentHash) continue;
    out.push({ tabId: t.id, path: t.savedPath, hash: node.contentHash });
  }
  return out;
}
