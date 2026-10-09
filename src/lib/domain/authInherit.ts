import type { AuthConfig, HttpRequest, TreeNode } from './types';
import { idToRel, parentId } from './tree';

const own = (a?: AuthConfig): AuthConfig | undefined => (a && a.type !== 'inherit' ? a : undefined);

type Folder = Extract<TreeNode, { kind: 'folder' }>;

/** Nearest ancestor folder of node `id` that sets auth (unset or 'inherit' folders are skipped). */
export function authFolderFor(tree: TreeNode[], id: string | undefined): Folder | undefined {
  for (let dir = id && idToRel(id) ? parentId(id) : undefined; dir; dir = parentId(dir)) {
    const folder = findFolder(tree, dir);
    if (own(folder?.auth)) return folder;
  }
  return undefined;
}

export const folderAuthFor = (tree: TreeNode[], id: string | undefined): AuthConfig | undefined => authFolderFor(tree, id)?.auth;

function findFolder(nodes: TreeNode[], id: string): Folder | undefined {
  for (const n of nodes) {
    if (n.kind === 'folder' && (n.id === id || id.startsWith(n.id + '/'))) return n.id === id ? n : findFolder(n.children, id);
  }
  return undefined;
}

/** Auth a send actually uses: the request's own, else the nearest collection's, else none. */
export function effectiveAuth(tree: TreeNode[], id: string | undefined, auth?: AuthConfig): AuthConfig {
  return own(auth) ?? folderAuthFor(tree, id) ?? { type: 'none', apiKeyIn: 'header' };
}

/** `x` with `request.auth` replaced by its effective auth (never 'inherit'). */
export function withEffectiveAuth<T extends { request: HttpRequest }>(x: T, tree: TreeNode[], id: string | undefined): T {
  return { ...x, request: { ...x.request, auth: effectiveAuth(tree, id, x.request.auth) } };
}
