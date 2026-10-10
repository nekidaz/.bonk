import { describe, expect, it } from 'vitest';
import type { FolderNode, RequestNode } from '$shared/model';
import type { Plan, PlanRequest } from './plan';
import { bodyLines, diffCollection, fingerprint, mergeRequest } from './reimport';

const node = (method: string, url: string, body = '', params: [string, string][] = []): RequestNode => ({
  kind: 'request',
  id: '',
  name: `${method} ${url}`,
  protocol: 'http',
  request: { method, url, headers: { 'Content-Type': 'application/json' }, body, bodyMode: 'raw' },
  ...(params.length ? { params: params.map(([key, value]) => ({ key, value, description: '', enabled: true })) } : {}),
});

/** A saved request as the last import left it, optionally edited by the user since. */
const saved = (id: string, op: string, imported: RequestNode, edit?: (n: RequestNode) => RequestNode): RequestNode => {
  const n = { ...imported, id, spec: { op, base: fingerprint(imported) } };
  return edit ? edit(n) : n;
};

const req = (link: string, n: RequestNode): PlanRequest => ({ kind: 'request', key: link, link, node: n, hint: '' });

describe('mergeRequest', () => {
  const was = node('POST', '{{baseUrl}}/payments', '{"amount": "1"}', [['page', '1']]);
  const next = node('POST', '{{baseUrl}}/v2/payments', '{"amount": 1, "metadata": {}}', [
    ['page', '1'],
    ['created_from', ''],
  ]);

  it('takes the spec where the user left the import as is', () => {
    const m = mergeRequest(saved('fs:a', 'create', was), fingerprint(was), next);
    expect(m.request.url).toBe('{{baseUrl}}/v2/payments');
    expect(m.request.body).toBe('{"amount": 1, "metadata": {}}');
    expect(m.params?.map((p) => p.key)).toEqual(['page', 'created_from']);
    expect(m.spec).toEqual({ op: 'create', base: fingerprint(next) });
  });

  it('keeps what the user edited: body, url, headers, auth, name', () => {
    const mine = saved('fs:a', 'create', was, (n) => ({
      ...n,
      name: 'Mine',
      request: {
        ...n.request,
        url: '{{host}}/payments',
        body: '{"amount": "42"}',
        headers: { ...n.request.headers, 'X-Trace': '1' },
        auth: { type: 'bearer', bearerToken: 'x' },
      },
    }));
    const m = mergeRequest(mine, fingerprint(was), next);
    expect([m.name, m.request.url, m.request.body]).toEqual(['Mine', '{{host}}/payments', '{"amount": "42"}']);
    expect(m.request.headers).toEqual({ 'Content-Type': 'application/json', 'X-Trace': '1' });
    expect(m.request.auth).toEqual({ type: 'bearer', bearerToken: 'x' });
  });
});

describe('diffCollection', () => {
  const listWas = node('GET', '{{baseUrl}}/payments');
  const voidWas = node('DELETE', '{{baseUrl}}/charges/{{id}}');
  const createWas = node('POST', '{{baseUrl}}/payments', '{\n  "amount": "1"\n}');
  const collection: FolderNode = {
    kind: 'folder',
    id: 'fs:api',
    name: 'API',
    expanded: true,
    children: [
      {
        kind: 'folder',
        id: 'fs:api/Payments',
        name: 'Payments',
        expanded: false,
        children: [
          saved('fs:api/Payments/List', 'list', listWas),
          saved('fs:api/Payments/Create', 'create', createWas),
        ],
      },
      saved('fs:api/Void', 'void', voidWas),
    ],
  };
  const plan: Plan = {
    title: 'API',
    envRows: [],
    items: [
      {
        kind: 'folder',
        key: 'f:Payments',
        name: 'Payments',
        items: [
          req('list', listWas),
          req('create', node('POST', '{{baseUrl}}/payments', '{\n  "amount": 1,\n  "metadata": {}\n}')),
          req('cancel', node('POST', '{{baseUrl}}/payments/{{id}}/cancel')),
        ],
      },
      {
        kind: 'folder',
        key: 'f:Disputes',
        name: 'Disputes',
        items: [req('disputes', node('GET', '{{baseUrl}}/disputes'))],
      },
    ],
  };

  it('sorts requests into new, changed, removed and unchanged', () => {
    const d = diffCollection(collection, plan);
    expect(d.added.map((a) => [a.key, a.folder, a.folderExists])).toEqual([
      ['cancel', 'Payments', true],
      ['disputes', 'Disputes', false],
    ]);
    expect(d.changed.map((c) => [c.id, c.what])).toEqual([
      ['fs:api/Payments/Create', ['тело: +metadata, amount → integer']],
    ]);
    expect(d.changed[0].body?.updated).toBe(true);
    expect(d.removed.map((r) => r.id)).toEqual(['fs:api/Void']);
    expect(d.unchanged).toBe(1);
  });

  it('marks body lines that differ', () => {
    const { was, now } = bodyLines('{\n  "amount": "1"\n}', '{\n  "amount": 1,\n  "metadata": {}\n}');
    expect(was.filter(([, d]) => d).map(([l]) => l.trim())).toEqual(['"amount": "1"']);
    expect(now.filter(([, d]) => d).map(([l]) => l.trim())).toEqual(['"amount": 1,', '"metadata": {}']);
  });
});
