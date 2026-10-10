import { describe, expect, it } from 'vitest';
import { HAR_DEFAULTS, harPlan, readHar, templateIds } from './har';
import type { PlanFolder, PlanRequest } from './plan';

const entry = (method: string, url: string, extra: Record<string, unknown> = {}) => ({
  _resourceType: 'fetch',
  request: { method, url, headers: [], cookies: [] },
  response: { status: 200, headers: [], content: { mimeType: 'application/json' } },
  ...extra,
});

const log = readHar(
  {
    pages: [{ title: 'Page' }],
    entries: [
      entry('POST', 'https://api.x.test/payments', {
        request: {
          method: 'POST',
          url: 'https://api.x.test/payments',
          headers: [
            { name: ':authority', value: 'api.x.test' },
            { name: 'Cookie', value: 'sid=1' },
            { name: 'sec-ch-ua', value: 'x' },
            { name: 'Accept', value: 'application/json' },
          ],
          cookies: [{ name: 'sid', value: '1' }],
          postData: { mimeType: 'application/json', text: '{"a":1}' },
        },
      }),
      entry('GET', 'https://api.x.test/payments/123'),
      entry('GET', 'https://api.x.test/payments/456'),
      entry('GET', 'https://api.x.test/payments?limit=20'),
      entry('GET', 'https://auth.x.test/token'),
      entry('GET', 'https://api.x.test/boom', { response: { status: 502, headers: [], content: {} } }),
      { request: { method: 'GET', url: 'https://cdn.x.test/app.js', headers: [] }, response: { status: 200 } },
      {
        _resourceType: 'document',
        request: { method: 'GET', url: 'https://x.test/', headers: [] },
        response: { status: 200 },
      },
    ],
  },
  'app.x.test.har',
);

describe('readHar', () => {
  it('classifies entries and collects cookies', () => {
    expect(log.title).toBe('app.x.test');
    expect(log.entries.map((e) => e.kind)).toEqual(['api', 'api', 'api', 'api', 'api', 'api', 'static', 'doc']);
    expect(log.cookies).toEqual([{ url: 'https://api.x.test', setCookie: 'sid=1; Path=/' }]);
  });
});

describe('harPlan', () => {
  it('takes API calls, merges ids, folders by domain, the busiest origin → {{baseUrl}}', () => {
    const p = harPlan(log, HAR_DEFAULTS);
    expect(p.kept).toBe(4);
    expect(p.skipped).toBe(3); // 5xx, static, document
    const api = p.items[0] as PlanFolder;
    expect(api.name).toBe('api.x.test');
    const reqs = api.items as PlanRequest[];
    expect(reqs.map((r) => [r.node.name, r.hint])).toEqual([
      ['payments', 'application/json'],
      ['payments/{{id}}', '×2 → 1'],
      ['payments', '?limit=20'],
    ]);
    expect(reqs[0].node.request.url).toBe('{{baseUrl}}/payments');
    expect(reqs[0].node.request.headers).toEqual({ Accept: 'application/json' });
    expect(p.envRows[0].vars).toEqual([{ key: 'baseUrl', value: 'https://api.x.test', enabled: true }]);
    // cdn and the page host have nothing left but are listed greyed with their totals.
    expect(
      p.items.map((f) => [(f as PlanFolder).name, (f as PlanFolder).items.length, (f as PlanFolder).total]),
    ).toEqual([
      ['api.x.test', 3, 5],
      ['auth.x.test', 1, 1],
      ['cdn.x.test', 0, 1],
      ['x.test', 0, 1],
    ]);
  });

  it('options: everything, no merge, flat, literal origin, raw headers', () => {
    const p = harPlan(log, {
      types: 'all',
      statics: true,
      okOnly: false,
      merge: false,
      byDomain: false,
      baseUrl: false,
      strip: false,
    });
    expect(p.kept).toBe(8);
    const first = p.items[0] as PlanRequest;
    expect(first.node.request.url).toBe('https://api.x.test/payments');
    expect(Object.keys(first.node.request.headers)).toEqual(['Cookie', 'sec-ch-ua', 'Accept']);
    expect(p.envRows).toEqual([]);
  });

  it('templates id-like segments only', () => {
    expect(templateIds('/v1/payments/123/capture')).toBe('/v1/payments/{{id}}/capture');
    expect(templateIds('/u/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab')).toBe('/u/{{id}}');
    expect(templateIds('/p/pay_8f2k1x9z')).toBe('/p/{{id}}');
    expect(templateIds('/api-v2-legacy-endpoint/list')).toBe('/api-v2-legacy-endpoint/list');
  });
});
