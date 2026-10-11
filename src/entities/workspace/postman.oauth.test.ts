import { describe, expect, it } from 'vitest';
import { buildPostmanCollection, parsePostmanCollection } from './postman';
import type { AuthConfig, TreeNode } from '$shared/model';

const folder = (auth: AuthConfig): TreeNode[] => [
  {
    kind: 'folder',
    id: 'fs:a',
    name: 'Pay',
    expanded: true,
    auth,
    children: [
      {
        kind: 'request',
        id: 'fs:a/l',
        name: 'List',
        protocol: 'http',
        request: { method: 'GET', url: 'https://x.test', headers: {}, auth: { type: 'inherit' } },
      },
    ],
  },
];

describe('Postman oauth2', () => {
  it('round-trips OAuth through a v2.1 collection', () => {
    const auth: AuthConfig = {
      type: 'oauth2',
      oauth: {
        grant: 'authorization_code',
        authUrl: '{{auth}}/authorize',
        tokenUrl: '{{auth}}/token',
        clientId: '{{client_id}}',
        clientSecret: '',
        clientAuth: 'basic',
        scope: 'read write',
        redirectUri: '',
        username: '',
        password: '',
      },
    };
    const text = buildPostmanCollection('W', folder(auth), [], false);
    expect(JSON.parse(text).item[0].auth.oauth2).toContainEqual({
      key: 'grant_type',
      value: 'authorization_code_with_pkce',
      type: 'string',
    });
    const back = parsePostmanCollection(text).items[0];
    if (back.kind !== 'folder') throw new Error('folder expected');
    const req = back.items[0];
    if (req.kind !== 'request') throw new Error('request expected');
    expect(req.node.request.auth).toEqual(auth);
  });

  it('drops the implicit grant', () => {
    const text = JSON.stringify({
      info: { name: 'W', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'implicit' }] },
      item: [{ name: 'r', request: { method: 'GET', url: 'https://x.test' } }],
    });
    const item = parsePostmanCollection(text).items[0];
    if (item.kind !== 'request') throw new Error('request expected');
    expect(item.node.request.auth?.type).not.toBe('oauth2');
  });
});
