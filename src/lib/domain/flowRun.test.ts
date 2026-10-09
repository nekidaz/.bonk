import { describe, it, expect } from 'vitest';
import type { Flow, FlowBlock, FlowEdge } from './flow';
import { executeFlow, type FlowEffects } from './flowRun';
import type { RunResultRow } from './types';

// ---- Test helpers -----------------------------------------------------------

function block(id: string, config: FlowBlock['config']): FlowBlock {
  return { id, x: 0, y: 0, config };
}

function edge(from: string, fromPort: string, to: string): FlowEdge {
  return { id: `${from}:${fromPort}->${to}`, from, fromPort, to };
}

function flow(blocks: FlowBlock[], edges: FlowEdge[]): Flow {
  return { id: 'f1', name: 'test flow', blocks, edges };
}

function okRow(requestName: string, ok = true): RunResultRow {
  return {
    id: requestName,
    iteration: 1,
    requestName,
    protocol: 'http',
    method: 'GET',
    target: 'https://x',
    status: ok ? 200 : 500,
    ok,
    elapsedMs: 1,
    tests: [],
    logs: [],
  };
}

/**
 * Recording fake effects. `log` collects one line per effect call so tests can
 * assert both order and payloads. Override individual effects per test.
 */
function fakeFx(overrides: Partial<FlowEffects> = {}) {
  const log: string[] = [];
  const fx: FlowEffects = {
    runRequest: async (requestId, payload, variables) => {
      log.push(`request:${requestId}:${JSON.stringify(payload)}:vars=${JSON.stringify(variables)}`);
      return { row: okRow(requestId), output: { status: 200, ok: true, body: { from: requestId } } };
    },
    runScript: async (code, payload) => {
      log.push(`script:${JSON.stringify(payload)}`);
      return { value: 'script-value', logs: [] };
    },
    sleep: async (ms) => {
      log.push(`sleep:${ms}`);
    },
    onBlock: (blockId, state) => {
      log.push(`block:${blockId}:${state}`);
    },
    onOutput: (blockId, label, payload) => {
      log.push(`output:${label}:${JSON.stringify(payload)}`);
    },
    isCancelled: () => false,
    ...overrides,
  };
  return { log, fx };
}

// ---- Tests ------------------------------------------------------------------

describe('executeFlow', () => {
  it('runs a linear flow, threading the payload block to block', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:login' }),
        block('j', { type: 'script', code: 'return payload.body.from;' }),
        block('d', { type: 'delay', ms: 25 }),
        block('o', { type: 'output', label: 'result' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'out', 'j'), edge('j', 'out', 'd'), edge('d', 'out', 'o')],
    );
    const { log, fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    // Request gets the start payload, script gets the request output,
    // delay sleeps, output receives the script's return value.
    expect(log).toContain('request:fs:login:{}:vars={}');
    expect(log).toContain('script:{"status":200,"ok":true,"body":{"from":"fs:login"}}');
    expect(log).toContain('sleep:25');
    expect(log).toContain('output:result:"script-value"');
    // Order: request before script before sleep before output.
    expect(log.indexOf('request:fs:login:{}:vars={}')).toBeLessThan(log.indexOf('sleep:25'));
    expect(log.indexOf('sleep:25')).toBeLessThan(log.indexOf('output:result:"script-value"'));
  });

  it('if block follows the true port when the condition is truthy', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('c', { type: 'if', condition: 'payload.ok' }),
        block('yes', { type: 'output', label: 'yes' }),
        block('no', { type: 'output', label: 'no' }),
      ],
      [edge('s', 'out', 'c'), edge('c', 'true', 'yes'), edge('c', 'false', 'no')],
    );
    const { log, fx } = fakeFx({
      runScript: async () => ({ value: true, logs: [] }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.some((l) => l.startsWith('output:yes'))).toBe(true);
    expect(log.some((l) => l.startsWith('output:no'))).toBe(false);
  });

  it('if block follows the false port when the condition is falsy', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('c', { type: 'if', condition: 'payload.ok' }),
        block('yes', { type: 'output', label: 'yes' }),
        block('no', { type: 'output', label: 'no' }),
      ],
      [edge('s', 'out', 'c'), edge('c', 'true', 'yes'), edge('c', 'false', 'no')],
    );
    const { log, fx } = fakeFx({
      runScript: async () => ({ value: false, logs: [] }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.some((l) => l.startsWith('output:no'))).toBe(true);
    expect(log.some((l) => l.startsWith('output:yes'))).toBe(false);
  });

  it('forEach loop runs the body once per item, then done with the original payload', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('mk', { type: 'script', code: 'return [1,2];' }),
        block('l', { type: 'loop', kind: 'forEach' }),
        block('body', { type: 'output', label: 'item' }),
        block('after', { type: 'output', label: 'after' }),
      ],
      [edge('s', 'out', 'mk'), edge('mk', 'out', 'l'), edge('l', 'each', 'body'), edge('l', 'done', 'after')],
    );
    const { log, fx } = fakeFx({
      runScript: async () => ({ value: [1, 2], logs: [] }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.filter((l) => l.startsWith('output:item')).length).toBe(2);
    expect(log).toContain('output:item:1');
    expect(log).toContain('output:item:2');
    expect(log).toContain('output:after:[1,2]');
    // Body items run before done.
    expect(log.indexOf('output:item:2')).toBeLessThan(log.indexOf('output:after:[1,2]'));
  });

  it('forEach loop with a non-array payload fails the run', async () => {
    const f = flow(
      [block('s', { type: 'start' }), block('l', { type: 'loop', kind: 'forEach' })],
      [edge('s', 'out', 'l')],
    );
    const { fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('error');
    expect(summary.error).toMatch(/массив/i);
  });

  it('count loop runs the body count times with the index as payload', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('l', { type: 'loop', kind: 'count', count: 3 }),
        block('body', { type: 'output', label: 'i' }),
      ],
      [edge('s', 'out', 'l'), edge('l', 'each', 'body')],
    );
    const { log, fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.filter((l) => l.startsWith('output:i')).length).toBe(3);
    expect(log).toContain('output:i:0');
    expect(log).toContain('output:i:2');
  });

  it('a cyclic graph is stopped by the step limit', async () => {
    const f = flow(
      [block('s', { type: 'start' }), block('d', { type: 'delay', ms: 0 })],
      [edge('s', 'out', 'd'), edge('d', 'out', 'd')],
    );
    const { fx } = fakeFx();

    const summary = await executeFlow(f, fx, 10);

    expect(summary.status).toBe('error');
    expect(summary.error).toMatch(/лимита шагов/i);
  });

  it('cancellation stops the run between blocks', async () => {
    let cancelled = false;
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('o', { type: 'output', label: 'never' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'out', 'o')],
    );
    const { log, fx } = fakeFx({
      runRequest: async (requestId) => {
        cancelled = true;
        return { row: okRow(requestId), output: {} };
      },
      isCancelled: () => cancelled,
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('cancelled');
    expect(log.some((l) => l.startsWith('output:never'))).toBe(false);
  });

  it('a fatal script error aborts the run', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('j', { type: 'script', code: 'boom' }),
        block('o', { type: 'output', label: 'never' }),
      ],
      [edge('s', 'out', 'j'), edge('j', 'out', 'o')],
    );
    const { log, fx } = fakeFx({
      runScript: async () => ({ value: undefined, logs: [], error: 'boom is not defined' }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('error');
    expect(summary.error).toBe('boom is not defined');
    expect(log.some((l) => l.startsWith('output:never'))).toBe(false);
    expect(log).toContain('block:j:error');
  });

  it('a request leaves through success or fail depending on its outcome', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('good', { type: 'output', label: 'succeeded' }),
        block('bad', { type: 'output', label: 'failed' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'success', 'good'), edge('r', 'fail', 'bad')],
    );

    const passing = fakeFx();
    await executeFlow(f, passing.fx);
    expect(passing.log.some((l) => l.startsWith('output:succeeded'))).toBe(true);
    expect(passing.log.some((l) => l.startsWith('output:failed'))).toBe(false);

    const failing = fakeFx({
      runRequest: async (requestId) => ({ row: okRow(requestId, false), output: { status: 500, ok: false } }),
    });
    await executeFlow(f, failing.fx);
    expect(failing.log.some((l) => l.startsWith('output:failed'))).toBe(true);
    expect(failing.log.some((l) => l.startsWith('output:succeeded'))).toBe(false);
  });

  it('an unwired fail port ends the branch without aborting the run', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('good', { type: 'output', label: 'succeeded' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'success', 'good')],
    );
    const { log, fx } = fakeFx({
      runRequest: async (requestId) => ({ row: okRow(requestId, false), output: { status: 403, ok: false } }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log).toContain('block:r:error');
    expect(log.some((l) => l.startsWith('output:succeeded'))).toBe(false);
  });

  it('a failed request does not abort a legacy `out`-wired flow', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('o', { type: 'output', label: 'still-runs' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'out', 'o')],
    );
    const { log, fx } = fakeFx({
      runRequest: async (requestId) => ({
        row: okRow(requestId, false),
        output: { status: 500, ok: false },
      }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.some((l) => l.startsWith('output:still-runs'))).toBe(true);
    expect(log).toContain('block:r:error');
  });

  it('a variable edge binds the source block output into the request variables', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('code', { type: 'script', code: "return '654321';" }),
        block('r', { type: 'request', requestId: 'fs:verify' }),
      ],
      [
        edge('s', 'out', 'code'),
        edge('code', 'out', 'r'),
        { id: 'wire', from: 'code', fromPort: 'out', to: 'r', toPort: 'var:OTPCode' },
      ],
    );
    const { log, fx } = fakeFx({
      runScript: async () => ({ value: '654321', logs: [] }),
    });

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log).toContain('request:fs:verify:"654321":vars={"OTPCode":"654321"}');
  });

  it('binds an object output as JSON and skips sources that have not run', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('later', { type: 'script', code: 'return 1;' }),
      ],
      [
        edge('s', 'out', 'r'),
        // start has run (payload {}), `later` never runs before the request.
        { id: 'w1', from: 's', fromPort: 'out', to: 'r', toPort: 'var:seed' },
        { id: 'w2', from: 'later', fromPort: 'out', to: 'r', toPort: 'var:missing' },
      ],
    );
    const { log, fx } = fakeFx();

    await executeFlow(f, fx);

    expect(log).toContain('request:fs:a:{}:vars={"seed":"{}"}');
  });

  it('a variable edge moves no execution on its own', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        block('r', { type: 'request', requestId: 'fs:a' }),
        block('o', { type: 'output', label: 'never' }),
      ],
      // The only edge into `o` is a variable wire, so `o` must never execute.
      [edge('s', 'out', 'r'), { id: 'w', from: 'r', fromPort: 'success', to: 'o', toPort: 'var:x' }],
    );
    const { log, fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.some((l) => l.startsWith('output:never'))).toBe(false);
  });

  it('a disabled block is skipped and hands its payload to the next block', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        { ...block('r', { type: 'request', requestId: 'fs:a' }), disabled: true },
        block('o', { type: 'output', label: 'after' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'success', 'o')],
    );
    const { log, fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('done');
    expect(log.some((l) => l.startsWith('request:'))).toBe(false);
    expect(log).toContain('block:r:skipped');
    // The start payload passes straight through the muted block.
    expect(log).toContain('output:after:{}');
  });

  it('a disabled block on legacy `out` wiring still passes through', async () => {
    const f = flow(
      [
        block('s', { type: 'start' }),
        { ...block('r', { type: 'request', requestId: 'fs:a' }), disabled: true },
        block('o', { type: 'output', label: 'after' }),
      ],
      [edge('s', 'out', 'r'), edge('r', 'out', 'o')],
    );
    const { log, fx } = fakeFx();

    await executeFlow(f, fx);

    expect(log).toContain('output:after:{}');
  });

  it('rejects a flow without a start block', async () => {
    const f = flow([block('o', { type: 'output', label: 'x' })], []);
    const { fx } = fakeFx();

    const summary = await executeFlow(f, fx);

    expect(summary.status).toBe('error');
    expect(summary.error).toMatch(/Старт/i);
  });
});
