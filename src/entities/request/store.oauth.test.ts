import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '$shared/model';
import type { RequestExecution } from '$shared/ipc';

vi.mock('$shared/ipc/api', () => ({
  requestRun: vi.fn(),
  workspaceSaveRequest: vi.fn(),
  workspaceLoad: vi.fn(),
  workspacePickFolder: vi.fn(),
  workspaceCreateFolder: vi.fn(),
  workspaceDelete: vi.fn(),
  workspaceRename: vi.fn(),
  workspaceDuplicate: vi.fn(),
  workspaceMove: vi.fn(),
}));
import { requestRun } from '$shared/ipc';
import { tabs } from '$entities/tab';
import { sendHttpRequest } from './store';
import { oauthRuntime } from './oauth.svelte';

const req: HttpRequest = {
  method: 'GET',
  url: 'https://api.test/me',
  headers: {},
  auth: { type: 'oauth2', oauth: { grant: 'client_credentials', tokenUrl: 'https://auth.test/token' } },
};
const execution = (): RequestExecution => ({
  row: {
    id: 'r',
    iteration: 1,
    requestName: 'A',
    protocol: 'http',
    method: 'GET',
    target: req.url,
    status: 200,
    ok: true,
    elapsedMs: 1,
    tests: [],
    logs: [],
  },
  details: {
    dynamic: [],
    request: req,
    response: { status: 200, headers: {}, body: '', final_url: req.url, elapsed_ms: 1, size_bytes: 0 },
    grpcResult: null,
    pre: null,
    post: null,
    postMs: null,
    oauth: {
      token: { accessToken: 't1', tokenType: 'Bearer', hasRefresh: true, expiresAt: null, scope: '', obtainedAt: 0 },
      renewed: true,
      previousExpiresAt: 100,
    },
  },
});

describe('shared-engine OAuth presentation', () => {
  beforeEach(() => {
    vi.mocked(requestRun).mockReset();
    tabs.list = [{ id: 'A', protocol: 'http', title: 'A', request: req }];
    tabs.activeId = 'A';
    oauthRuntime.renewals = {};
  });

  it('shows the renewal details returned by the engine on the originating tab', async () => {
    vi.mocked(requestRun).mockResolvedValue(execution());
    await sendHttpRequest('A', req, 'r1');
    expect(oauthRuntime.renewals.A).toMatchObject({ byRefresh: true, previousExpiresAt: 100, sent: { status: 200 } });
    expect(tabs.list[0].response?.status).toBe(200);
  });

  it('surfaces an engine OAuth failure without recording a fresh response', async () => {
    const failed = execution();
    failed.row.error = 'OAuth: no token yet';
    failed.row.ok = false;
    failed.details.response = null;
    failed.details.oauth = null;
    vi.mocked(requestRun).mockResolvedValue(failed);
    await expect(sendHttpRequest('A', req, 'r1')).rejects.toThrow('OAuth: no token yet');
    expect(tabs.list[0].response).toBeUndefined();
  });
});
