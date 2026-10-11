import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse, Tab } from '$shared/model';

// The IPC boundary stays pending to exercise origin-tab and origin-environment delivery.
vi.mock('$shared/ipc/api', () => ({
  requestRun: vi.fn(),
  httpResolve: vi.fn(async (req: unknown) => req),
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

import { requestRun, type RequestExecution, type RunEvent } from '$shared/ipc';
import { environments } from '$entities/environment';
import { cookieJar } from '$entities/cookies';
import { tabs } from '$entities/tab';
import { sendHttpRequest } from './store';

const execute = vi.mocked(requestRun);

function tab(id: string): Tab {
  return {
    id,
    protocol: 'http',
    title: id,
    request: { method: 'GET', url: `https://example.com/${id}`, headers: {} },
  };
}

const req: HttpRequest = { method: 'GET', url: 'https://example.com/a', headers: {} };
const fakeResponse: HttpResponse = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
  final_url: 'https://example.com/a',
  elapsed_ms: 12,
  size_bytes: 11,
};

describe('sendHttpRequest routing', () => {
  beforeEach(() => {
    execute.mockReset();
    tabs.list = [tab('A'), tab('B')];
    tabs.activeId = 'A';
  });

  it('routes the response to the tab it was started from, not the active tab', async () => {
    // The core request stays pending until we resolve it, simulating a slow request.
    const clearCookies = vi.spyOn(cookieJar, 'clearFor').mockResolvedValue();
    const refreshCookies = vi.spyOn(cookieJar, 'refresh').mockResolvedValue();
    let resolveSend!: (res: RequestExecution) => void;
    let event!: (event: RunEvent) => void;
    environments.list = [
      { id: 'envA', name: 'A', vars: [] },
      { id: 'envB', name: 'B', vars: [] },
    ];
    environments.activeId = 'envA';
    execute.mockImplementation((_id, _node, _plan, _vars, _settings, _grpc, onEvent) => {
      event = onEvent;
      return new Promise<RequestExecution>((resolve) => {
        resolveSend = resolve;
      });
    });

    // Start the request from tab A while A is active.
    const pending = sendHttpRequest('A', req, 'r1');

    // User switches to tab B BEFORE the request returns.
    tabs.activeId = 'B';

    // Now the slow request resolves.
    environments.activeId = 'envB';
    event({
      kind: 'vars',
      envSet: { token: 'from-A' },
      envUnset: [],
      globalsSet: {},
      globalsUnset: [],
      cookieClears: ['https://example.com/a'],
    });
    resolveSend({
      row: {
        id: 'row',
        iteration: 1,
        requestName: 'A',
        protocol: 'http',
        method: 'GET',
        target: req.url,
        status: 200,
        ok: true,
        elapsedMs: 12,
        tests: [],
        logs: [],
      },
      details: {
        dynamic: [],
        request: req,
        response: fakeResponse,
        grpcResult: null,
        pre: null,
        post: null,
        postMs: null,
        oauth: null,
      },
    });
    await pending;
    expect(clearCookies).not.toHaveBeenCalled();
    clearCookies.mockRestore();
    refreshCookies.mockRestore();

    const a = getTabs().find((t) => t.id === 'A');
    const b = getTabs().find((t) => t.id === 'B');

    expect(a?.response).toEqual(fakeResponse);
    expect(b?.response).toBeUndefined();
    expect(environments.list.find((e) => e.id === 'envA')?.vars).toEqual([
      { key: 'token', value: 'from-A', enabled: true },
    ]);
    expect(environments.list.find((e) => e.id === 'envB')?.vars).toEqual([]);
    expect(execute.mock.calls[0][4]).toMatchObject({ timeoutMs: 30_000, followRedirects: true, validateTls: true });
  });

  it('updateTabById only mutates the targeted tab', () => {
    tabs.updateById('B', (t) => ({ ...t, title: 'renamed-B' }));
    const list = getTabs();
    expect(list.find((t) => t.id === 'A')?.title).toBe('A');
    expect(list.find((t) => t.id === 'B')?.title).toBe('renamed-B');
  });
});

function getTabs(): Tab[] {
  return tabs.list;
}
