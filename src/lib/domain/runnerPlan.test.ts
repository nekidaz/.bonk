import { describe, expect, it } from 'vitest';
import type { RequestNode, RunResultRow, TreeNode } from './types';
import {
  DEFAULT_CONFIG,
  DEFAULT_RUN,
  RUNNER_ROOT,
  allTestsPassed,
  bindIdNodes,
  buildReport,
  clampDelay,
  clampIterations,
  collectRequests,
  iterationCount,
  mergeSavedConfig,
  orderedRequests,
  plannedRequests,
  runnerScopeTitle,
} from './runnerPlan';

const req = (id: string, extra: Partial<RequestNode['request']> = {}): RequestNode =>
  ({
    kind: 'request',
    id,
    name: id,
    protocol: 'http',
    request: { method: 'GET', url: `https://x/${id}`, headers: {}, ...extra },
  }) as RequestNode;
const folder = (id: string, children: TreeNode[]): TreeNode => ({ kind: 'folder', id, name: id, children }) as TreeNode;
const tree: TreeNode[] = [req('a'), folder('f', [req('f/b'), folder('f/g', [req('f/g/c')])]), req('d')];
const cfg = (p: Partial<typeof DEFAULT_CONFIG> = {}) => ({ ...DEFAULT_CONFIG, ...p });
const ids = (l: RequestNode[]) => l.map((n) => n.id);

describe('runner scope planning', () => {
  it('flattens depth-first; empty / root sentinel / unknown ids = whole tree', () => {
    const all = ['a', 'f/b', 'f/g/c', 'd'];
    expect(ids(collectRequests([], tree))).toEqual(all);
    expect(ids(collectRequests([RUNNER_ROOT], tree))).toEqual(all);
    expect(ids(collectRequests(['nope'], tree))).toEqual(all);
  });
  it('a nested pick does not run twice', () => {
    expect(ids(collectRequests(['f', 'f/g'], tree))).toEqual(['f/b', 'f/g/c']);
  });
  it('custom order first, the rest keep tree order; excluded dropped from the plan', () => {
    const c = cfg({ orderIds: ['d', 'f/b'], excludedIds: ['a'] });
    expect(ids(orderedRequests(c, tree))).toEqual(['d', 'f/b', 'a', 'f/g/c']);
    expect(ids(plannedRequests(c, tree))).toEqual(['d', 'f/b', 'f/g/c']);
  });
  it('scope title: first existing folder, else the "all" label', () => {
    const tr = (k: string) => k;
    expect(runnerScopeTitle(['nope', 'f'], tree, tr)).toBe('f');
    expect(runnerScopeTitle([], tree, tr)).toBe('runner.allRequests');
  });
});

describe('runner settings', () => {
  it('clamps iterations and delay', () => {
    expect([clampIterations(0), clampIterations(2.6), clampIterations(NaN)]).toEqual([1, 3, 1]);
    expect([clampDelay(-5), clampDelay(10.4), clampDelay(Infinity)]).toEqual([0, 10, 0]);
  });
  it('iteration count follows data rows', () => {
    expect(iterationCount({ dataRows: [], iterations: 0 })).toBe(1);
    expect(iterationCount({ dataRows: [], iterations: 4 })).toBe(4);
    expect(iterationCount({ dataRows: [{}, {}], iterations: 4 })).toBe(2);
  });
  it('merges only well-typed saved fields', () => {
    const m = mergeSavedConfig(cfg({ iterations: 3 }), {
      iterations: 'x',
      delayMs: 50,
      folderIds: ['a', 1],
      excludedIds: 'no',
      stopOnFailure: true,
    });
    expect(m).toMatchObject({
      iterations: 3,
      delayMs: 50,
      folderIds: ['a'],
      excludedIds: [],
      stopOnFailure: true,
      saveResponses: true,
    });
    expect(mergeSavedConfig(cfg(), null)).toEqual(cfg());
  });
});

describe('runner report', () => {
  const row = (ok: boolean): RunResultRow => ({
    id: String(ok),
    iteration: 1,
    requestName: 'r',
    protocol: 'http',
    method: 'GET',
    target: 't',
    status: ok ? 200 : 500,
    ok,
    elapsedMs: 1,
    tests: [],
    logs: [],
    responseBody: 'body',
  });
  const run = { ...DEFAULT_RUN, results: [row(true), row(false)], total: 2, completed: 2 };
  it('counts pass/fail and strips bodies unless saveResponses', () => {
    const kept = buildReport(cfg(), run);
    expect([kept.passed, kept.failed, (kept.rows[0] as RunResultRow).responseBody]).toEqual([1, 1, 'body']);
    expect(buildReport(cfg({ saveResponses: false }), run).rows.every((r) => !('responseBody' in r))).toBe(true);
  });
});

describe('bindIdNodes', () => {
  const b = { sourceNodeId: 's', varName: 'uid', literal: '42' } as Parameters<typeof bindIdNodes>[2];
  it('appends the setter line once and rewrites the literal in the target url', () => {
    const src = req('s', { testScript: 'x();' });
    const dst = req('d', { url: 'https://x/users/42/42' });
    const [s1, d1] = bindIdNodes(src, dst, b, true);
    expect(s1.request.testScript).toBe("x();\npm.environment.set('uid', pm.response.json().id);");
    expect(d1.request.url).toBe('https://x/users/{{uid}}/{{uid}}');
    expect(bindIdNodes(s1, dst, b, true)[0]).toBe(s1);
    expect(bindIdNodes(req('s'), dst, b, false)[0].request.testScript).toBe(
      "pm.globals.set('uid', pm.response.json().id);",
    );
  });
});

describe('allTestsPassed', () => {
  it('is vacuously true', () => {
    expect(allTestsPassed([])).toBe(true);
    expect(allTestsPassed([{ name: 'a', passed: false }] as never)).toBe(false);
  });
});
