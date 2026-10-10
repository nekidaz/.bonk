import { describe, it, expect } from 'vitest';
import { collectScriptRun, parseScriptResult } from './scripts';

describe('parseScriptResult returnValue', () => {
  it('passes through the script return value untouched', () => {
    const out = parseScriptResult(JSON.stringify({ logs: [], tests: [], returnValue: { token: 'abc', n: 2 } }));
    expect(out.returnValue).toEqual({ token: 'abc', n: 2 });
  });

  it('leaves returnValue undefined when the script returned nothing', () => {
    const out = parseScriptResult(JSON.stringify({ logs: ['hi'], tests: [] }));
    expect(out.returnValue).toBeUndefined();
    expect(out.logs).toEqual(['hi']);
  });
});

describe('parseScriptResult lines and events', () => {
  it('keeps test/error lines and known console rows', () => {
    const out = parseScriptResult(
      JSON.stringify({
        tests: [{ name: 'a', passed: false, error: 'AssertionError: x', line: 4, errorLine: 6 }],
        error: 'ReferenceError: sign is not defined',
        errorLine: 3,
        events: [
          { t: 5, kind: 'env', op: 'set', key: 'ts', value: '1' },
          { t: 6, kind: 'bogus' },
        ],
      }),
    );
    expect(out.tests[0]).toMatchObject({ line: 4, errorLine: 6 });
    expect(out.errorLine).toBe(3);
    expect(out.events).toEqual([
      { t: 5, kind: 'env', op: 'set', key: 'ts', value: '1', text: undefined, name: undefined, passed: undefined },
    ]);
  });
});

describe('collectScriptRun', () => {
  const result = (over: object) => parseScriptResult(JSON.stringify({ tests: [], logs: [], ...over }));

  it('is undefined when neither stage ran', () => {
    expect(collectScriptRun({})).toBeUndefined();
  });

  it('tags stages, orders the console pre → send → post and keeps the failing stage', () => {
    const pre = result({ logs: ['p'], events: [{ t: 1, kind: 'log', text: 'p' }] });
    const post = result({
      tests: [{ name: 't', passed: true, line: 1 }],
      events: [{ t: 3, kind: 'test', name: 't', passed: true }],
      error: 'boom',
      errorLine: 9,
    });
    const run = collectScriptRun({ pre, post, send: { t: 2, text: 'GET u', status: '200', ms: 5 }, postMs: 4 })!;
    expect(run.tests).toEqual([
      { name: 't', passed: true, line: 1, stage: 'post', error: undefined, errorLine: undefined },
    ]);
    expect(run.events!.map((e) => `${e.stage}:${e.kind}`)).toEqual(['pre:log', 'send:send', 'post:test']);
    expect(run).toMatchObject({ error: 'boom', errorLine: 9, errorPhase: 'post', postMs: 4, logs: ['p'] });
  });

  it('marks a pre-request failure', () => {
    const run = collectScriptRun({ pre: result({ error: 'x', errorLine: 2 }) })!;
    expect(run).toMatchObject({ errorPhase: 'pre', errorLine: 2 });
  });
});
