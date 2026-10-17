import { describe, expect, it } from 'vitest';
import { parseCurlFile, parseInsomniaExport } from './importers';

describe('Insomnia import', () => {
  const doc = {
    _type: 'export',
    __export_format: 4,
    resources: [
      { _id: 'wrk_1', _type: 'workspace', name: 'My API', parentId: null },
      { _id: 'fld_1', _type: 'request_group', name: 'Users', parentId: 'wrk_1' },
      { _id: 'fld_2', _type: 'request_group', name: 'Admin', parentId: 'fld_1' },
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'fld_2',
        name: 'Create',
        method: 'post',
        url: '{{ _.baseUrl }}/users',
        parameters: [
          { name: 'a', value: '1' },
          { name: 'b', value: '2', disabled: true },
        ],
        headers: [
          { name: 'X-T', value: '{{_.tok}}' },
          { name: 'Off', value: 'x', disabled: true },
        ],
        body: { mimeType: 'application/json', text: '{"n":"{{ _.name }}"}' },
        authentication: { type: 'bearer', token: '{{ _.tok }}' },
      },
      { _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'Root', method: 'GET', url: 'https://x.io' },
      { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', data: { baseUrl: 'https://x.io', tok: 'abc' } },
    ],
  };
  const text = JSON.stringify(doc);

  it('maps folders, templates, requests and env vars', () => {
    const c = parseInsomniaExport(text);
    expect(c.title).toBe('My API');
    expect(c.variables).toEqual([
      { key: 'baseUrl', value: 'https://x.io', enabled: true },
      { key: 'tok', value: 'abc', enabled: true },
    ]);
    const users = c.items.find((i) => i.kind === 'folder');
    expect(users).toMatchObject({ name: 'Users' });
    const admin = users!.kind === 'folder' ? users!.items[0] : null;
    expect(admin).toMatchObject({ kind: 'folder', name: 'Admin' });
    const req = admin!.kind === 'folder' ? admin!.items[0] : null;
    if (req?.kind !== 'request') throw new Error('expected request');
    expect(req.node.request.method).toBe('POST');
    expect(req.node.request.url).toBe('{{baseUrl}}/users?a=1');
    expect(req.node.request.headers).toEqual({ 'X-T': '{{tok}}' });
    expect(req.node.request.body).toBe('{"n":"{{name}}"}');
    expect(req.node.request.rawBodyFormat).toBe('JSON');
    expect(req.node.request.auth).toEqual({ type: 'bearer', bearerToken: '{{tok}}' });
    expect(req.node.id).toBe('');
    expect(c.items.some((i) => i.kind === 'request')).toBe(true);
  });
});

describe('Insomnia GraphQL import', () => {
  function importBody(text: string) {
    const out = parseInsomniaExport(
      JSON.stringify({
        _type: 'export',
        __export_format: 4,
        resources: [
          { _id: 'wrk_1', _type: 'workspace', name: 'W', parentId: null },
          {
            _id: 'req_1',
            _type: 'request',
            parentId: 'wrk_1',
            name: 'Q',
            method: 'POST',
            url: 'https://x.io/graphql',
            body: { mimeType: 'application/graphql', text },
          },
        ],
      }),
    );
    const item = out.items[0];
    if (item?.kind !== 'request') throw new Error('expected request');
    return item.node.request;
  }

  it('imports query and variables as a GraphQL body', () => {
    const r = importBody('{"query":"query { a }","variables":{"id":"{{ _.id }}"}}');
    expect(r.bodyMode).toBe('graphql');
    expect(r.body).toBe('query { a }');
    expect(JSON.parse(r.graphqlVariables!)).toEqual({ id: '{{id}}' });
    expect(r.graphqlVariables).toBe('{\n  "id": "{{id}}"\n}');
  });

  it('leaves variables undefined when absent', () => {
    const r = importBody('{"query":"{ a }"}');
    expect(r.bodyMode).toBe('graphql');
    expect(r.graphqlVariables).toBeUndefined();
  });

  it('falls back to a raw text body when the text is not JSON', () => {
    const r = importBody('not json');
    expect(r.bodyMode).toBe('raw');
    expect(r.rawBodyFormat).toBe('Text');
    expect(r.body).toBe('not json');
  });
});

describe('cURL file import', () => {
  it('parses several commands, with line continuations', () => {
    const text = "curl -X POST https://a.test/x \\\n  -H 'A: b' -d '{}'\n# note\ncurl https://a.test/y?q=1";
    const out = parseCurlFile(text);
    expect(out.items).toHaveLength(2);
    const first = out.items[0];
    if (first.kind !== 'request') throw new Error('expected request');
    expect(first.node.name).toBe('POST /x');
    expect(first.node.request.headers).toEqual({ A: 'b' });
    expect(() => parseCurlFile('hello')).toThrow();
  });
});
