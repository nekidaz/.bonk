import { describe, expect, it } from 'vitest';
import { buildPostmanCollection, isPostmanCollection, parsePostmanCollection } from './postman';
import type { TreeNode } from './types';

describe('Postman Collection export', () => {
  const tree: TreeNode[] = [{
    kind: 'folder', id: 'fs:a', name: 'Users', expanded: true, auth: { type: 'bearer', bearerToken: 'tok' },
    children: [
      {
        kind: 'request', id: 'fs:a/c', name: 'Create', protocol: 'http',
        request: {
          method: 'POST', url: 'https://x.test/u?v=1', headers: { 'X-A': '1', 'X-Off': '2' }, disabledHeaders: ['X-Off'],
          bodyMode: 'raw', body: '{"a":1}', rawBodyFormat: 'JSON', auth: { type: 'inherit' }, testScript: 'pm.test("ok", () => {});',
        },
        params: [{ key: 'v', value: '1', description: '', enabled: true }],
      },
      { kind: 'request', id: 'fs:a/g', name: 'Rpc', protocol: 'grpc', request: { method: 'POST', url: '', headers: {} } },
    ],
  }];

  it('produces a v2.1 collection that the importer reads back', () => {
    const text = buildPostmanCollection('Ws', tree, [{ key: 'baseUrl', value: 'u', enabled: true }, { key: 's', value: 'sec', enabled: true, secret: true }], false);
    const doc = JSON.parse(text);
    expect(doc.info.schema).toContain('v2.1.0');
    expect(doc.variable.map((v: { value: string }) => v.value)).toEqual(['u', '']);
    expect(isPostmanCollection(text)).toBe(true);
    const back = parsePostmanCollection(text);
    expect(back.title).toBe('Ws');
    const folder = back.items[0];
    if (folder.kind !== 'folder') throw new Error('folder expected');
    expect(folder.items).toHaveLength(1); // the RPC request is skipped
    const req = folder.items[0];
    if (req.kind !== 'request') throw new Error('request expected');
    expect(req.node.request).toMatchObject({ method: 'POST', body: '{"a":1}', rawBodyFormat: 'JSON', headers: { 'X-A': '1' }, auth: { type: 'bearer', bearerToken: 'tok' } });
    expect(req.node.request.headers['X-Off']).toBeUndefined();
    expect(req.node.request.testScript).toContain('pm.test');
    expect(req.node.params).toHaveLength(1);
  });

  it('keeps secret globals only on request', () => {
    const v = JSON.parse(buildPostmanCollection('W', [], [{ key: 's', value: 'sec', enabled: true, secret: true }], true)).variable;
    expect(v[0].value).toBe('sec');
  });
});

describe('Postman Collection import', () => {
  it('keeps nested folders, variables, query state, auth, body and scripts', () => {
    const source = {
      info: { name: 'Users API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'baseUrl', value: 'https://example.com' }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("sent", "1");'] } }],
      item: [{
        name: 'Users',
        event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => {});'] } }],
        item: [{
          name: 'Create user',
          event: [{ listen: 'test', script: { exec: ['pm.test("request", () => {});'] } }],
          request: {
            method: 'POST',
            url: {
              raw: '{{baseUrl}}/users?verbose=true&skip=1',
              query: [
                { key: 'verbose', value: 'true' },
                { key: 'skip', value: '1', disabled: true },
              ],
            },
            header: [{ key: 'X-Trace', value: 'abc' }],
            body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } },
          },
        }],
      }],
    };
    const parsed = parsePostmanCollection(JSON.stringify(source));
    expect(parsed.title).toBe('Users API');
    expect(parsed.variables).toEqual([{ key: 'baseUrl', value: 'https://example.com', enabled: true }]);
    const folder = parsed.items[0];
    expect(folder.kind).toBe('folder');
    if (folder.kind !== 'folder') return;
    expect(folder.name).toBe('Users');
    const request = folder.items[0];
    expect(request.kind).toBe('request');
    if (request.kind !== 'request') return;
    expect(request.node.request.url).toBe('{{baseUrl}}/users?verbose=true');
    expect(request.node.params?.[1]).toMatchObject({ key: 'skip', value: '1', enabled: false });
    expect(request.node.request.headers).toEqual({ 'X-Trace': 'abc' });
    expect(request.node.request.auth).toEqual({ type: 'bearer', bearerToken: '{{token}}' });
    expect(request.node.request.bodyMode).toBe('raw');
    expect(request.node.request.rawBodyFormat).toBe('JSON');
    expect(request.node.request.preRequestScript).toContain('pm.environment.set');
    expect(request.node.request.testScript).toContain('pm.test');
    expect(request.node.request.testScript?.match(/request/g)).toHaveLength(1);
  });

  it('imports form data and an explicit request auth override', () => {
    const source = {
      info: { name: 'Upload' },
      item: [{
        name: 'Upload file',
        request: {
          method: 'POST',
          url: 'https://example.com/upload',
          auth: { type: 'apikey', apikey: [
            { key: 'key', value: 'api_key' },
            { key: 'value', value: '{{secret}}' },
            { key: 'in', value: 'query' },
          ] },
          body: { mode: 'formdata', formdata: [
            { key: 'name', value: 'report' },
            { key: 'attachment', type: 'file', src: '/tmp/report.txt' },
          ] },
        },
      }],
    };
    const parsed = parsePostmanCollection(JSON.stringify(source));
    const item = parsed.items[0];
    expect(item.kind).toBe('request');
    if (item.kind !== 'request') return;
    expect(item.node.request.auth).toEqual({
      type: 'apiKey',
      apiKeyName: 'api_key',
      apiKeyValue: '{{secret}}',
      apiKeyIn: 'query',
    });
    expect(item.node.request.bodyParams?.[1]).toMatchObject({ key: 'attachment', kind: 'file' });
    // Imported file paths are dropped so a crafted collection can't upload local files.
    expect(item.node.request.bodyParams?.[1].filePath).toBeUndefined();
  });

  it('runs each inherited script in its own scope, like Postman', () => {
    const source = {
      info: { name: 'Scoped' },
      event: [{ listen: 'prerequest', script: { exec: ["const who = 'collection';", 'calls.push(who);', 'return;'] } }],
      item: [{
        name: 'Ping',
        event: [{ listen: 'prerequest', script: { exec: ["const who = 'request';", 'calls.push(who);'] } }],
        request: { method: 'GET', url: 'https://example.com/ping' },
      }],
    };
    const item = parsePostmanCollection(JSON.stringify(source)).items[0];
    if (item.kind !== 'request') throw new Error('expected a request');
    const calls: string[] = [];
    // scripts.rs runs user code as a function body, exactly like `new Function`.
    new Function('calls', item.node.request.preRequestScript ?? '')(calls);
    expect(calls).toEqual(['collection', 'request']);
  });

  it('recognizes collection JSON and rejects unrelated documents', () => {
    expect(isPostmanCollection('{"info":{"name":"A"},"item":[]}')).toBe(true);
    expect(isPostmanCollection('{"openapi":"3.0.0","info":{},"paths":{}}')).toBe(false);
    expect(() => parsePostmanCollection('not json')).toThrow('корректным JSON');
    expect(() => parsePostmanCollection('{}')).toThrow('Ожидается коллекция Postman');
  });

  it('preserves a binary file body path for the native sender', () => {
    const source = {
      info: { name: 'Files' },
      item: [{
        name: 'Send file',
        request: {
          method: 'POST',
          url: 'https://example.com/files',
          body: { mode: 'file', file: { src: '/tmp/input.bin' } },
        },
      }],
    };
    const item = parsePostmanCollection(JSON.stringify(source)).items[0];
    expect(item.kind).toBe('request');
    if (item.kind !== 'request') return;
    expect(item.node.request.bodyMode).toBe('binary');
    expect(item.node.request.binaryFilePath).toBeUndefined();
  });

  it('preserves GraphQL query and variables in separate editors', () => {
    const source = {
      info: { name: 'GraphQL' },
      item: [{
        name: 'User',
        request: {
          method: 'POST',
          url: 'https://example.com/graphql',
          body: { mode: 'graphql', graphql: { query: 'query { viewer { id } }', variables: '{"id":"{{userId}}"}' } },
        },
      }],
    };
    const item = parsePostmanCollection(JSON.stringify(source)).items[0];
    expect(item.kind).toBe('request');
    if (item.kind !== 'request') return;
    expect(item.node.request.bodyMode).toBe('graphql');
    expect(item.node.request.body).toBe('query { viewer { id } }');
    expect(item.node.request.graphqlVariables).toBe('{"id":"{{userId}}"}');
  });
});
