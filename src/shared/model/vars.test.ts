import { describe, expect, it } from 'vitest';
import { countRequestsUsingVars, maskSecret, mergeScope } from './vars';
import type { RequestNode, TreeNode } from './types';

const req = (id: string, url: string, headers: Record<string, string> = {}): RequestNode => ({
  kind: 'request',
  id,
  name: id,
  protocol: 'http',
  request: { method: 'GET', url, headers },
});

describe('countRequestsUsingVars', () => {
  const tree: TreeNode[] = [
    req('a', '{{ baseUrl }}/x'),
    {
      kind: 'folder',
      id: 'f',
      name: 'f',
      expanded: true,
      children: [req('b', '/y', { Authorization: 'Bearer {{token}}' }), req('c', '/z')],
    },
  ];
  it('counts requests (nested, any field) that reference a key', () => {
    expect(countRequestsUsingVars(tree, ['baseUrl', 'token'])).toBe(2);
    expect(countRequestsUsingVars(tree, ['token'])).toBe(1);
    expect(countRequestsUsingVars(tree, ['nope', ''])).toBe(0);
    expect(countRequestsUsingVars(tree, [])).toBe(0);
  });
});

describe('mergeScope redactSecrets', () => {
  it('keeps secret vars as literal placeholders', () => {
    const env = {
      id: 'e',
      name: 'E',
      vars: [
        { key: 'token', value: 's3cret', enabled: true, secret: true },
        { key: 'host', value: 'h', enabled: true },
      ],
    };
    expect(mergeScope([], env)).toEqual({ token: 's3cret', host: 'h' });
    expect(mergeScope([], env, true)).toEqual({ token: '{{token}}', host: 'h' });
  });
});

describe('maskSecret', () => {
  it('keeps a prefix and the last 4 characters', () => {
    expect(maskSecret('sk_live_' + 'x'.repeat(12) + '4f2a')).toBe('sk_live_' + '•'.repeat(12) + '4f2a');
    expect(maskSecret('abc')).toBe('•••');
    expect(maskSecret('123456789')).toBe('1' + '•'.repeat(12) + '6789');
  });
});
