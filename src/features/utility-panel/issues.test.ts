import { describe, expect, it } from 'vitest';
import type { AppConsoleEntry } from '$entities/request';
import { groupIssues, hostOf, issuesOf, openIssues, outage, routeOf, sparkline } from './issues';

let n = 0;
const e = (p: Partial<AppConsoleEntry>): AppConsoleEntry => ({
  id: String(n++),
  at: 1_000_000 + n * 1000,
  protocol: 'http',
  method: 'GET',
  url: 'https://api.x/v1/payments',
  ok: false,
  status: '404',
  elapsedMs: 10,
  ...p,
});

describe('issuesOf', () => {
  it('classifies by cause', () => {
    expect(issuesOf(e({ status: '404' }))[0]).toMatchObject({
      kind: '4xx',
      code: '404',
      title: 'issues.title.notFound',
    });
    expect(issuesOf(e({ status: '500' }))[0].kind).toBe('5xx');
    expect(issuesOf(e({ status: 'ERROR', message: 'connect ECONNREFUSED 10.0.0.1:443' }))[0]).toMatchObject({
      kind: 'network',
      code: 'ECONNREFUSED',
    });
    expect(issuesOf(e({ status: 'ERROR', message: 'operation timed out' }))[0].code).toBe('timeout');
    expect(issuesOf(e({ protocol: 'grpc', url: 'grpc.x:443', status: 'UNAVAILABLE' }))[0]).toMatchObject({
      kind: 'network',
      code: '14 UNAVAILABLE',
      host: 'grpc.x:443',
    });
    expect(issuesOf(e({ protocol: 'grpc', url: 'grpc.x:443', status: 'NOT_FOUND' }))[0].kind).toBe('4xx');
    expect(issuesOf(e({ status: 'SCRIPT ERROR', message: 'ReferenceError: sign is not defined' }))[0]).toMatchObject({
      kind: 'script',
      code: 'ReferenceError',
    });
  });

  it('turns each failed test of a 200 into its own issue', () => {
    const list = issuesOf(
      e({
        status: '200',
        tests: [
          { name: 'fast', passed: false },
          { name: 'has id', passed: true },
          { name: 'json', passed: false },
        ],
      }),
    );
    expect(list.map((x) => [x.kind, x.arg])).toEqual([
      ['test', 'fast'],
      ['test', 'json'],
    ]);
  });
});

describe('openIssues', () => {
  it('drops a request once a later send of it succeeds', () => {
    const fixed = e({ url: 'https://api.x/a' });
    const still = e({ url: 'https://api.x/b' });
    const ok = e({ url: 'https://api.x/a', ok: true, status: '200' });
    expect(openIssues([fixed, still, ok]).map((x) => x.entry)).toEqual([still]);
  });
});

describe('groupIssues', () => {
  const list = openIssues([
    e({ url: 'https://api.x/v1/payments/pay_111111', method: 'DELETE' }),
    e({ url: 'https://api.x/v1/payments/pay_222222', method: 'DELETE' }),
    e({ url: 'https://api.x/v1/other', status: '500' }),
  ]);

  it('folds ids into one route per cause', () => {
    const groups = groupIssues(list, 'cause');
    expect(groups.map((g) => [g.codes[0], g.count])).toEqual([
      ['404', 2],
      ['500', 1],
    ]);
  });

  it('groups by host with per-request children', () => {
    const [g] = groupIssues(list, 'host');
    expect(g).toMatchObject({ key: 'api.x', count: 3 });
    expect(g.children).toHaveLength(3);
  });
});

describe('helpers', () => {
  it('hostOf and routeOf', () => {
    expect(hostOf('grpc.x:443 · pkg.Svc/Call')).toBe('grpc.x:443');
    expect(hostOf('https://api.x/v1')).toBe('api.x');
    expect(routeOf('https://api.x/v1/customers/cus_19ab12?x=1')).toBe('/v1/customers/{id}');
    expect(routeOf('https://api.x/v1/orders/42')).toBe('/v1/orders/{id}');
  });

  it('sparkline buckets the last hour', () => {
    const now = 10_000_000;
    const s = sparkline(issuesOf(e({ at: now - 1000 })).concat(issuesOf(e({ at: now - 3_500_000 }))), now);
    expect(s[11]).toBe(1);
    expect(s[0]).toBe(1);
  });

  it('outage needs many failures over several requests on one host', () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      e({ protocol: 'grpc', url: `grpc.x:443 · Svc/M${i % 2}`, status: 'UNAVAILABLE', at: i * 60_000 }),
    );
    expect(outage(openIssues(entries), entries)).toMatchObject({ host: 'grpc.x:443', count: 6, minutes: 5 });
    expect(outage(openIssues(entries.slice(0, 4)), entries)).toBeUndefined();
  });
});
