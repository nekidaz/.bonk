import { describe, expect, it } from 'vitest';
import type { RequestNode, RunResultRow } from '$shared/model';
import {
  buildMatrix,
  compactJson,
  durationDelta,
  insightFor,
  p95,
  p95Delta,
  passedDelta,
  pushHistory,
  pushRecord,
  relDay,
  runBars,
  toRecord,
  RECORD_BODY,
  RECORD_ROWS,
  statusLabel,
  testCount,
  varLinks,
  summarizeRun,
  testDetail,
  waterfall,
  type RunSummary,
} from './runnerStats';

const row = (p: Partial<RunResultRow>): RunResultRow => ({
  id: crypto.randomUUID(),
  iteration: 1,
  requestName: 'r',
  protocol: 'http',
  method: 'GET',
  target: 'https://x/',
  status: 200,
  ok: true,
  elapsedMs: 100,
  tests: [],
  logs: [],
  ...p,
});
const sum = (p: Partial<RunSummary>): RunSummary => ({
  n: 1,
  startedAt: 0,
  passed: 16,
  total: 16,
  durationMs: 3600,
  p95Ms: 194,
  ...p,
});

describe('runnerStats', () => {
  it('p95 is nearest-rank', () => {
    expect(p95([])).toBe(0);
    expect(p95([10, 20, 212, 30])).toBe(212);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
  });

  it('summary, history cap and deltas', () => {
    const s = summarizeRun(42, 1000, 4200, [row({ elapsedMs: 212 }), row({ ok: false, elapsedMs: 88 })]);
    expect(s).toMatchObject({ n: 42, passed: 1, total: 2, durationMs: 3200, p95Ms: 212 });
    // The runner's own clock wins over wall time (which can jump, or be frozen in the visual suite).
    expect(summarizeRun(42, 1000, 1000, [row({ endMs: 2900 }), row({ endMs: 3150 })]).durationMs).toBe(3150);
    const prev = sum({ n: 41 });
    const cur = sum({ n: 42, passed: 14, durationMs: 3200, p95Ms: 212 });
    expect(passedDelta(cur, prev)).toEqual({ text: '−2 vs #41', tone: 'danger' });
    expect(durationDelta(cur, prev)).toEqual({ text: '−0.4 s', tone: 'success' });
    expect(p95Delta(cur, prev)).toEqual({ text: '+18 ms', tone: 'warning' });
    expect(passedDelta(cur, undefined)).toBeNull();
    expect(passedDelta(prev, prev)).toBeNull();
    const h = Array.from({ length: 12 }, (_, i) => sum({ n: i + 1 })).reduce(
      (l, x) => pushHistory(l, x),
      [] as RunSummary[],
    );
    expect(h.map((x) => x.n)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(
      runBars([sum({ durationMs: 2000 }), sum({ durationMs: 3000 }), sum({ durationMs: 4000, passed: 1 })]),
    ).toEqual([
      { n: 1, h: 14, failed: false },
      { n: 1, h: 21, failed: false },
      { n: 1, h: 28, failed: true },
    ]);
    expect(runBars([sum({})])[0].h).toBe(14);
  });

  it('matrix and waterfall', () => {
    const rows = [
      row({ nodeId: 'a', iteration: 1 }),
      row({ nodeId: 'b', iteration: 1 }),
      row({ nodeId: 'a', iteration: 2, startOffsetMs: 0, elapsedMs: 100 }),
      row({ nodeId: 'b', iteration: 2, startOffsetMs: 100, elapsedMs: 300, ok: true }),
    ];
    const m = buildMatrix(rows, 2);
    expect(m.map((r) => r.key)).toEqual(['a', 'b']);
    expect(m[1].cells[1]).toBe(rows[3]);
    expect(waterfall(m.map((r) => r.cells[1]))).toEqual([
      { left: 0, width: 25, tone: 'normal' },
      { left: 25, width: 75, tone: 'slow' },
    ]);
  });

  it('insight: re-used id 404 suggests binding the earlier created id', () => {
    const refund1 = row({
      nodeId: 'refund',
      iteration: 1,
      method: 'DELETE',
      target: 'https://api/v1/payments/pay_8f2k1/refund',
    });
    const create2 = row({
      nodeId: 'create',
      requestName: 'Create payment',
      iteration: 2,
      method: 'POST',
      responseBody: '{"id":"pay_9a1c3"}',
    });
    const refund2 = { ...refund1, id: 'x', iteration: 2, status: 404, ok: false };
    const ins = insightFor(refund2, [refund1, create2, refund2]);
    expect(ins?.text).toBe(
      'In iteration 1 the request returned 200 — the resource is already deleted. Iteration 2 needs a new id.',
    );
    expect(ins?.bind).toEqual({
      sourceNodeId: 'create',
      sourceName: 'Create payment',
      literal: 'pay_8f2k1',
      varName: 'paymentId',
    });
    expect(insightFor(refund1, [refund1])).toBeNull();
    expect(insightFor({ ...refund2, target: 'https://api/v1/x' }, [refund2])).toBeNull();
  });

  it('formatting helpers', () => {
    expect(statusLabel(404)).toBe('404 Not Found');
    expect(statusLabel('UNAVAILABLE')).toBe('UNAVAILABLE');
    expect(compactJson('{\n  "error": "payment not found"\n}')).toBe('{ "error": "payment not found" }');
    expect(compactJson('oops')).toBe('oops');
    const r = row({ elapsedMs: 88 });
    expect(testDetail({ name: 'response time < 500 ms', passed: true }, r)).toBe('88 ms');
    expect(testDetail({ name: 'status is 2xx', passed: false, error: 'получен 404' }, r)).toBe('получен 404');
  });

  it('setup helpers: test count, var hand-offs, relative day', () => {
    const req = (name: string, url: string, testScript = ''): RequestNode => ({
      kind: 'request',
      id: name,
      name,
      protocol: 'http',
      request: { method: 'GET', url, headers: {}, testScript },
    });
    const create = req(
      'create',
      'https://x/p',
      "pm.test('a', () => {}); pm.test('b', () => {});\npm.environment.set('paymentId', pm.response.json().id);",
    );
    const list = [
      req('list', 'https://x/{{paymentId}}'),
      create,
      req('get', 'https://x/p/{{paymentId}}'),
      req('del', 'https://x/p/{{ paymentId }}'),
    ];
    expect(testCount(create)).toBe(2);
    expect(varLinks(list)).toEqual([
      { sets: [], uses: [] }, // reads before anyone sets it
      { sets: ['paymentId'], uses: [] },
      { sets: [], uses: ['paymentId'] },
      { sets: [], uses: ['paymentId'] },
    ]);
    const now = new Date(2026, 9, 9, 0, 30).getTime();
    expect(relDay(now - 3_600_000, now)).toBe('yesterday');
    expect(relDay(now, now)).toBe('today');
  });
});

describe('run records', () => {
  const run = (n: number, results: RunResultRow[]) => ({ n, startedAt: 1, finishedAt: 2, iterations: 1, results });
  it('keeps truncated bodies only when asked', () => {
    const r = [row({ responseBody: 'x'.repeat(RECORD_BODY + 50) }), row({})];
    expect(toRecord(run(1, r), true).results[0].responseBody).toHaveLength(RECORD_BODY);
    expect(toRecord(run(1, r), true).results[1]).not.toHaveProperty('responseBody');
    expect(toRecord(run(1, r), false).results[0]).not.toHaveProperty('responseBody');
  });
  it('never saves what was typed into an «ask on send» field', () => {
    const r = [row({ inputs: { otp: '••••13' } })];
    expect(toRecord(run(1, r), true).results[0]).not.toHaveProperty('inputs');
  });
  it('bounds the rows', () => {
    expect(
      toRecord(
        run(
          1,
          Array.from({ length: RECORD_ROWS + 5 }, () => row({})),
        ),
        false,
      ).results,
    ).toHaveLength(RECORD_ROWS);
  });
  it('push replaces the same run and keeps the newest', () => {
    let l = [1, 2, 3].map((n) => toRecord(run(n, []), false));
    l = pushRecord(l, toRecord(run(2, [row({})]), false));
    expect(l.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(l[1].results).toHaveLength(1);
    expect(pushRecord(l, toRecord(run(4, []), false), 3).map((x) => x.n)).toEqual([2, 3, 4]);
  });
});
