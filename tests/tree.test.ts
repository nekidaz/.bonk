import { describe, it, expect } from 'vitest';
import { filterTree, findNode, findParent, idToRel, relToParts } from '../src/lib/domain/tree';
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

describe('filterTree', () => {
  const req = (id: string, name: string, url = '', endpoint?: string): TreeNode =>
    endpoint === undefined
      ? { kind: 'request', id: `fs:${id}`, name, protocol: 'http', request: { method: 'GET', url, headers: {} } }
      : { kind: 'request', id: `fs:${id}`, name, protocol: 'grpc', request: { method: 'GRPC', url: '', headers: {} }, grpc: { endpoint, plaintext: true, message: '{}', metadata: {} } };
  const folder = (id: string, name: string, children: TreeNode[], expanded = false): TreeNode =>
    ({ kind: 'folder', id: `fs:${id}`, name, expanded, children });

  const fixture: TreeNode[] = [
    folder('Payments', 'Payments', [
      req('Payments/charge', 'Create charge', 'https://api.pay.io/charge'),
      folder('Payments/Refunds', 'Refunds', [req('Payments/Refunds/full', 'Full refund')]),
    ]),
    req('users', 'List users', 'https://api.example.com/users'),
    req('grpc-actions', 'GetActions', '', 'localhost:50051'),
  ];

  it('returns the input unchanged for a blank query', () => {
    expect(filterTree(fixture, '')).toBe(fixture);
    expect(filterTree(fixture, '   ')).toBe(fixture);
  });

  it('matches request names case-insensitively and keeps ancestor folders expanded', () => {
    const out = filterTree(fixture, 'FULL REFUND');
    expect(out).toHaveLength(1);
    const payments = out[0];
    if (payments.kind !== 'folder') throw new Error('expected folder');
    expect(payments.expanded).toBe(true);
    expect(payments.children).toHaveLength(1);
    const refunds = payments.children[0];
    if (refunds.kind !== 'folder') throw new Error('expected folder');
    expect(refunds.expanded).toBe(true);
    expect(refunds.children.map((c) => c.name)).toEqual(['Full refund']);
  });

  it('a folder-name match keeps its entire subtree', () => {
    const out = filterTree(fixture, 'payments');
    expect(out).toHaveLength(1);
    const payments = out[0];
    if (payments.kind !== 'folder') throw new Error('expected folder');
    // Whole subtree intact, not narrowed to matching descendants.
    expect(payments.children).toHaveLength(2);
  });

  it('matches request urls and grpc endpoints', () => {
    expect(filterTree(fixture, 'example.com').map((n) => n.name)).toEqual(['List users']);
    expect(filterTree(fixture, '50051').map((n) => n.name)).toEqual(['GetActions']);
  });

  it('returns empty for no matches and never mutates the input', () => {
    expect(filterTree(fixture, 'zzz-no-match')).toEqual([]);
    const payments = fixture[0];
    if (payments.kind !== 'folder') throw new Error('expected folder');
    expect(payments.expanded).toBe(false); // filtering forced copies, not the input
  });
});
