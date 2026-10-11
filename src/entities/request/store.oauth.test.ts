import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse, OAuthEnsured } from '$shared/model';

vi.mock('$shared/ipc/api', () => ({
  httpSend: vi.fn(),
  httpResolve: vi.fn(async (req: unknown) => ({ request: req, dynamic: [] })),
  oauthToken: vi.fn(),
  runScript: vi.fn(),
  filePick: vi.fn(),
  cancelRequest: vi.fn(),
  workspaceLoad: vi.fn(),
  workspacePickFolder: vi.fn(),
  workspaceCreateFolder: vi.fn(),
  workspaceSaveRequest: vi.fn(),
  workspaceDelete: vi.fn(),
  workspaceRename: vi.fn(),
  workspaceDuplicate: vi.fn(),
  workspaceMove: vi.fn(),
}));

import { httpSend, oauthToken } from '$shared/ipc';
import { tabs } from '$entities/tab';
import { sendHttpRequest } from './store';
import { oauthRuntime } from './oauth.svelte';

const send = vi.mocked(httpSend);
const token = vi.mocked(oauthToken);

const req: HttpRequest = {
  method: 'GET',
  url: 'https://api.test/me',
  headers: {},
  auth: { type: 'oauth2', oauth: { grant: 'client_credentials', tokenUrl: 'https://auth.test/token' } },
};
const res = (status: number): HttpResponse => ({
  status,
  headers: {},
  body: '',
  final_url: req.url,
  elapsed_ms: 1,
  size_bytes: 0,
});
const ensured = (accessToken: string, renewed: boolean): OAuthEnsured => ({
  token: { accessToken, tokenType: 'Bearer', hasRefresh: true, expiresAt: null, scope: '', obtainedAt: 0 },
  renewed,
  previousExpiresAt: renewed ? 100 : null,
});

describe('sendHttpRequest with OAuth', () => {
  beforeEach(() => {
    send.mockReset();
    token.mockReset();
    tabs.list = [{ id: 'A', protocol: 'http', title: 'A', request: req }];
    tabs.activeId = 'A';
    oauthRuntime.renewals = {};
  });

  it('sends the keychain token and notes a renewal', async () => {
    token.mockResolvedValue(ensured('t1', true));
    send.mockResolvedValue(res(200));
    await sendHttpRequest('A', req, 'r1');
    expect(send.mock.calls[0][0].auth?.bearerToken).toBe('t1');
    expect(token.mock.calls[0][3]).toBe(false);
    expect(oauthRuntime.renewals.A).toMatchObject({ byRefresh: true, sent: { status: 200 } });
  });

  it('renews once on 401 and resends', async () => {
    token.mockResolvedValueOnce(ensured('old', false)).mockResolvedValueOnce(ensured('new', true));
    send.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    await sendHttpRequest('A', req, 'r1');
    expect(send.mock.calls.map((c) => c[0].auth?.bearerToken)).toEqual(['old', 'new']);
    expect(token.mock.calls[1][3]).toBe(true);
    expect(tabs.list[0].response?.status).toBe(200);
  });

  it('keeps the 401 when the token cannot be renewed', async () => {
    token.mockResolvedValueOnce(ensured('old', false)).mockRejectedValueOnce({ kind: 'login', reason: 'x' });
    send.mockResolvedValue(res(401));
    await sendHttpRequest('A', req, 'r1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(tabs.list[0].response?.status).toBe(401);
  });

  it('fails readably when there is no token', async () => {
    token.mockRejectedValue({ kind: 'login', reason: 'no token yet' });
    await expect(sendHttpRequest('A', req, 'r1')).rejects.toThrow('OAuth: no token yet');
    expect(send).not.toHaveBeenCalled();
  });
});
