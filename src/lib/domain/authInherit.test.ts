import { describe, expect, it } from 'vitest';
import { effectiveAuth, folderAuthFor } from './authInherit';
import type { TreeNode } from './types';

const bearer = { type: 'bearer', bearerToken: '{{token}}' } as const;
const req = (id: string): TreeNode => ({
  kind: 'request',
  id,
  name: 'r',
  protocol: 'http',
  request: { method: 'GET', url: '', headers: {} },
});
const tree: TreeNode[] = [
  {
    kind: 'folder',
    id: 'fs:a',
    name: 'a',
    expanded: true,
    auth: bearer,
    children: [
      req('fs:a/r'),
      { kind: 'folder', id: 'fs:a/b', name: 'b', expanded: true, children: [req('fs:a/b/r')] },
      { kind: 'folder', id: 'fs:a/c', name: 'c', expanded: true, auth: { type: 'none' }, children: [req('fs:a/c/r')] },
    ],
  },
  req('fs:root'),
];

describe('authInherit', () => {
  it('finds nearest ancestor auth', () => {
    expect(folderAuthFor(tree, 'fs:a/r')).toEqual(bearer);
    expect(folderAuthFor(tree, 'fs:a/b/r')).toEqual(bearer);
    expect(folderAuthFor(tree, 'fs:a/c/r')).toEqual({ type: 'none' });
    expect(folderAuthFor(tree, 'fs:root')).toBeUndefined();
  });
  it('own auth wins; unset/inherit resolves, default none', () => {
    expect(effectiveAuth(tree, 'fs:a/r', { type: 'basic' }).type).toBe('basic');
    expect(effectiveAuth(tree, 'fs:a/r', { type: 'inherit' })).toEqual(bearer);
    expect(effectiveAuth(tree, 'fs:a/r')).toEqual(bearer);
    expect(effectiveAuth(tree, undefined).type).toBe('none');
  });
});
