import { describe, expect, it } from 'vitest';
import { readOpenApi, parsePostmanCollection } from '$entities/workspace';
import type { Environment } from '$shared/model';
import {
  collectionPlan,
  countPlan,
  defaultTargets,
  openApiPlan,
  pruneExcluded,
  requestsIn,
  type PlanFolder,
} from './plan';

const spec = readOpenApi(
  {
    openapi: '3.0.3',
    info: { title: 'Payments API', version: '1' },
    servers: [
      { url: 'https://api.x.test/v1', description: 'Production' },
      { url: 'https://sandbox.x.test/v1', description: 'Sandbox' },
    ],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearerAuth: [] }],
    paths: {
      '/payments': {
        get: { tags: ['Payments'], operationId: 'list' },
        post: { tags: ['Payments'], operationId: 'create' },
      },
      '/payments/{id}': { get: { tags: ['Payments'], operationId: 'get' } },
      '/refunds': { post: { tags: ['Refunds'], operationId: 'refund' } },
      '/health': { get: { operationId: 'health', security: [] } },
    },
  },
  'p.yaml',
);

describe('openApiPlan', () => {
  it('groups by tag, by path or not at all', () => {
    const byTag = openApiPlan(spec, 'tags');
    expect(byTag.items.map((i) => (i.kind === 'folder' ? i.name : i.key))).toEqual(['Payments', 'Refunds', 'health']);
    expect((byTag.items[0] as PlanFolder).items.map((r) => (r.kind === 'request' ? r.hint : ''))).toEqual([
      '/payments',
      '/payments',
      '/payments/{{id}}',
    ]);
    const byPath = openApiPlan(spec, 'paths');
    expect(byPath.items.map((i) => (i.kind === 'folder' ? i.name : i.key))).toEqual(['payments', 'refunds', 'health']);
    expect(openApiPlan(spec, 'flat').items.every((i) => i.kind === 'request')).toBe(true);
  });

  it('puts the scheme on the collection and one env row per server', () => {
    const p = openApiPlan(spec, 'tags');
    expect(p.collectionAuth).toEqual({ type: 'bearer', bearerToken: '{{token}}' });
    expect(requestsIn(p.items).find((r) => r.key === 'health')?.node.request.auth).toEqual({ type: 'none' });
    expect(p.envRows.map((r) => [r.label, r.suggest])).toEqual([
      ['https://api.x.test/v1', 'Production'],
      ['https://sandbox.x.test/v1', 'Sandbox'],
    ]);
  });

  it('prunes unchecked requests and emptied folders, then counts', () => {
    const p = openApiPlan(spec, 'tags');
    const kept = pruneExcluded(p.items, new Set(['refund', 'list']));
    expect(kept.map((i) => (i.kind === 'folder' ? i.name : i.key))).toEqual(['Payments', 'health']);
    expect(countPlan(kept)).toEqual({ folders: 1, requests: 3 });
  });
});

describe('collectionPlan', () => {
  it('keeps the collection tree and links requests by method and path', () => {
    const c = parsePostmanCollection(
      JSON.stringify({
        info: { name: 'P' },
        variable: [{ key: 'baseUrl', value: 'https://x.test' }],
        item: [
          { name: 'Users', item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/users?page=1' } }] },
        ],
      }),
    );
    const p = collectionPlan(c);
    const [req] = requestsIn(p.items);
    expect([req.key, req.link, req.hint]).toEqual(['p:0/0', 'GET /users', '/users']);
    expect(p.envRows[0].label).toBe('1 переменная коллекции');
  });
});

describe('defaultTargets', () => {
  const envs: Environment[] = [
    { id: 'e1', name: 'Production', vars: [] },
    { id: 'e2', name: 'Staging', vars: [{ key: 'baseUrl', value: 'https://stage.x.test', enabled: true }] },
  ];
  const row = (url: string, suggest: string, active = false) => ({
    key: url,
    label: url,
    vars: [{ key: 'baseUrl', value: url, enabled: true }],
    suggest,
    active,
  });

  it('matches by address, then by name, else a new environment with a free name', () => {
    expect(
      defaultTargets(
        [
          row('https://api.x.test', 'Production'),
          row('https://stage.x.test', 'Whatever'),
          row('https://a', 'Staging 2'),
          row('https://b', 'New'),
        ],
        envs,
        null,
      ),
    ).toEqual([
      { kind: 'env', id: 'e1' },
      { kind: 'env', id: 'e2' },
      { kind: 'new', name: 'Staging 2' },
      { kind: 'new', name: 'New' },
    ]);
  });

  it('prefers the active environment for a HAR origin, and never reuses a new name', () => {
    expect(defaultTargets([row('https://h', 'app', true)], envs, 'e2')).toEqual([{ kind: 'env', id: 'e2' }]);
    expect(defaultTargets([row('https://p', 'Api'), row('https://q', 'Api')], [], null)).toEqual([
      { kind: 'new', name: 'Api' },
      { kind: 'new', name: 'Api 2' },
    ]);
  });
});
