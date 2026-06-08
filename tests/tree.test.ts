import { describe, it, expect } from 'vitest';
import { findNode, findParent, idToRel, relToParts } from '../src/lib/domain/tree';
import type { TreeNode } from '../src/lib/domain/types';

const tree: TreeNode[] = [
  {
    kind: 'folder', id: 'fs:API', name: 'API', expanded: true,
    children: [
      { kind: 'request', id: 'fs:API/Ping.bonk.json', name: 'Ping', protocol: 'http', request: { method: 'GET', url: '', headers: {} } },
      { kind: 'folder', id: 'fs:API/Sub', name: 'Sub', expanded: true, children: [] },
    ],
  },
];

describe('tree helpers', () => {
  it('finds a nested node by id', () => {
    expect(findNode(tree, 'fs:API/Sub')?.name).toBe('Sub');
    expect(findNode(tree, 'fs:API/Ping.bonk.json')?.name).toBe('Ping');
    expect(findNode(tree, 'fs:nope')).toBeUndefined();
  });
  it('finds the parent folder of a node', () => {
    expect(findParent(tree, 'fs:API/Ping.bonk.json')?.id).toBe('fs:API');
    expect(findParent(tree, 'fs:API')).toBeUndefined(); // top-level has no parent folder
  });
  it('converts id to rel path', () => {
    expect(idToRel('fs:API/Sub')).toBe('API/Sub');
    expect(idToRel('fs:')).toBe('');
  });
  it('splits rel parts', () => {
    expect(relToParts('API/Sub')).toEqual(['API', 'Sub']);
    expect(relToParts('')).toEqual([]);
  });
});
