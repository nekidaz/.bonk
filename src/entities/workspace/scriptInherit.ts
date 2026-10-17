import { joinScripts, type FolderNode, type TreeNode } from '$shared/model';
import { findNode, idToRel, parentId } from './tree';

export interface Scripts {
  preRequestScript?: string;
  testScript?: string;
}

/** Ancestor folders of node `id` that carry a script, root first (the order they run in). */
export function scriptFoldersFor(tree: TreeNode[], id: string | undefined): FolderNode[] {
  const out: FolderNode[] = [];
  for (let dir = id && idToRel(id) ? parentId(id) : undefined; dir; dir = parentId(dir)) {
    const folder = findNode(tree, dir);
    if (folder?.kind === 'folder' && (folder.preRequestScript?.trim() || folder.testScript?.trim()))
      out.unshift(folder);
  }
  return out;
}

/**
 * The scripts a send runs: every ancestor folder's (root first), then the request's own, each in its own
 * scope (see `joinScripts`). Mirrors `effective_scripts` in bonk-core's request_prep.rs.
 */
export function effectiveScripts(tree: TreeNode[], id: string | undefined, own: Scripts): Required<Scripts> {
  const folders = scriptFoldersFor(tree, id);
  return {
    preRequestScript: joinScripts([...folders.map((f) => f.preRequestScript), own.preRequestScript]),
    testScript: joinScripts([...folders.map((f) => f.testScript), own.testScript]),
  };
}
