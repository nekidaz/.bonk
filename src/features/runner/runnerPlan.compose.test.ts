import { describe, expect, it } from 'vitest';
import type { RequestNode, TreeNode } from '$shared/model';
import {
  DEFAULT_CONFIG,
  RUNNER_ROOT,
  isRemovable,
  orderedRequests,
  searchRequests,
  withRequestAdded,
  withRequestMoved,
  withRequestRemoved,
} from './runnerPlan';

const req = (id: string, url = `https://x/${id}`): RequestNode =>
  ({ kind: 'request', id, name: id, protocol: 'http', request: { method: 'GET', url, headers: {} } }) as RequestNode;
const folder = (id: string, name: string, children: TreeNode[]): TreeNode =>
  ({ kind: 'folder', id, name, children }) as TreeNode;
const tree: TreeNode[] = [
  folder('auth', 'auth', [req('auth/sso', 'https://h/sso/v1/authenticate'), req('auth/otp')]),
  folder('profile', 'profile', [req('profile/me', 'https://h/main/v2/me')]),
];
const cfg = (p: Partial<typeof DEFAULT_CONFIG> = {}) => ({ ...DEFAULT_CONFIG, ...p });
const run = (c: typeof DEFAULT_CONFIG) => orderedRequests(c, tree).map((n) => n.id);

describe('composing a run from single requests', () => {
  it('appends a request from another folder and re-checks one already in the run', () => {
    const c = withRequestAdded(cfg({ folderIds: ['auth/sso'] }), 'profile/me', tree);
    expect(run(c)).toEqual(['auth/sso', 'profile/me']);
    const back = withRequestAdded(cfg({ folderIds: ['auth'], excludedIds: ['auth/otp'] }), 'auth/otp', tree);
    expect(back.folderIds).toEqual(['auth']);
    expect(back.excludedIds).toEqual([]);
    expect(withRequestAdded(cfg({ folderIds: [RUNNER_ROOT] }), 'auth/sso', tree).folderIds).toEqual([RUNNER_ROOT]);
  });

  it('removes only a request picked on its own, never the last pick', () => {
    const c = cfg({ folderIds: ['auth/sso', 'profile/me'], orderIds: ['profile/me', 'auth/sso'] });
    expect(withRequestRemoved(c, 'profile/me')).toMatchObject({ folderIds: ['auth/sso'], orderIds: ['auth/sso'] });
    expect(isRemovable(cfg({ folderIds: ['auth/sso'] }), 'auth/sso')).toBe(false);
    expect(isRemovable(cfg({ folderIds: ['auth', 'profile/me'] }), 'auth/otp')).toBe(false);
    expect(withRequestRemoved(cfg({ folderIds: ['auth/sso'] }), 'auth/sso').folderIds).toEqual(['auth/sso']);
  });

  it('moves a request one step and ignores a move past either end', () => {
    const c = cfg({ folderIds: ['auth', 'profile/me'] });
    const order = run(c);
    expect(run(withRequestMoved(c, order, 'profile/me', -1))).toEqual(['auth/sso', 'profile/me', 'auth/otp']);
    expect(withRequestMoved(c, order, 'auth/sso', -1)).toBe(c);
    expect(withRequestMoved(c, order, 'profile/me', 1)).toBe(c);
  });

  it('finds requests by name, URL or folder, with the folder path', () => {
    expect(searchRequests(tree, 'AUTHENTICATE')).toEqual([
      { node: tree[0].kind === 'folder' && tree[0].children[0], path: 'auth' },
    ]);
    expect(searchRequests(tree, 'profile').map((h) => h.node.id)).toEqual(['profile/me']);
    expect(searchRequests(tree, '', 2).map((h) => h.node.id)).toEqual(['auth/sso', 'auth/otp']);
  });
});
