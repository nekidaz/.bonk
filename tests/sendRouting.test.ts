import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse, Tab } from '../src/lib/domain/types';

// Mock the entire api module. stores.ts imports httpSend (the call under test)
// plus the workspace* helpers; every named export it uses must be stubbed or the
// module-eval in stores.ts throws. We never exercise the workspace paths here.
vi.mock('../src/lib/api', () => ({
  httpSend: vi.fn(),
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

import { httpSend } from '../src/lib/api';
import { tabs, activeTabId, sendHttpRequest, updateTabById } from '../src/lib/stores';

const mockHttpSend = vi.mocked(httpSend);

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
    mockHttpSend.mockReset();
    tabs.set([tab('A'), tab('B')]);
    activeTabId.set('A');
  });

  it('routes the response to the tab it was started from, not the active tab', async () => {
    // httpSend stays pending until we resolve it, simulating a slow request.
    let resolveSend!: (res: HttpResponse) => void;
    mockHttpSend.mockReturnValue(new Promise<HttpResponse>((resolve) => { resolveSend = resolve; }));

    // Start the request from tab A while A is active.
    const pending = sendHttpRequest('A', req, 'r1');

    // User switches to tab B BEFORE the request returns.
    activeTabId.set('B');

    // Now the slow request resolves.
    resolveSend(fakeResponse);
    await pending;

    const a = getTabs().find((t) => t.id === 'A');
    const b = getTabs().find((t) => t.id === 'B');

    expect(a?.response).toEqual(fakeResponse);
    expect(b?.response).toBeUndefined();
    expect(mockHttpSend).toHaveBeenCalledWith(
      req,
      'r1',
      expect.objectContaining({
        timeoutMs: 30_000,
        followRedirects: true,
        validateTls: true,
      }),
    );
  });

  it('updateTabById only mutates the targeted tab', () => {
    updateTabById('B', (t) => ({ ...t, title: 'renamed-B' }));
    const list = getTabs();
    expect(list.find((t) => t.id === 'A')?.title).toBe('A');
    expect(list.find((t) => t.id === 'B')?.title).toBe('renamed-B');
  });
});

function getTabs(): Tab[] {
  let snapshot: Tab[] = [];
  const unsub = tabs.subscribe((v) => { snapshot = v; });
  unsub();
  return snapshot;
}
