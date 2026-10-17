import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpResponse, Tab } from '$shared/model';

vi.mock('$shared/ipc/api', () => ({
  requestRun: vi.fn(),
  httpResolve: vi.fn(async (req: unknown) => req),
}));
// Only the call matters here, so the real env/globals writers stay out of it.
vi.mock('./executionState', async (orig) => ({
  ...(await orig<typeof import('./executionState')>()),
  applyScriptVars: vi.fn(),
}));

import { requestRun, type RequestExecution } from '$shared/ipc';
import { applyScriptVars } from './executionState';
import { introspectHttp } from './introspect';

const run = vi.mocked(requestRun);
const applied = vi.mocked(applyScriptVars);

const response: HttpResponse = { status: 200, headers: {}, body: '{}', final_url: '', elapsed_ms: 1, size_bytes: 2 };
const tab: Tab = {
  id: 'T',
  protocol: 'http',
  title: 'T',
  request: { method: 'POST', url: 'https://example.com/graphql', headers: {} },
};

describe('introspectHttp', () => {
  beforeEach(() => {
    run.mockReset();
    applied.mockReset();
  });

  it('ignores script variable writes (a session login must not touch the environment)', async () => {
    run.mockImplementation(async (_id, _node, _plan, _vars, _settings, _grpc, onEvent) => {
      onEvent({
        kind: 'vars',
        envSet: { token: 'from-login' },
        envUnset: [],
        globalsSet: {},
        globalsUnset: [],
        cookieClears: [],
      });
      return {
        row: {},
        details: { response },
      } as unknown as RequestExecution;
    });
    await expect(introspectHttp(tab, '{ __typename }', 'fail')).resolves.toEqual(response);
    expect(run).toHaveBeenCalledOnce();
    expect(applied).not.toHaveBeenCalled();
  });
});
