import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../src/lib/domain/types';

// stores.ts imports the api module at eval time; every named export it uses must
// be stubbed or the module-eval throws. We never exercise the workspace/send
// paths here — this file only covers history retention.
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

// persist.ts talks to Tauri via `invoke`, unavailable under vitest. `hydrate()`
// is what registers the "lowering historyLimit truncates existing" subscription,
// so we run it once with persist stubbed to wire that behavior up.
vi.mock('../src/lib/persist', () => ({
  loadState: vi.fn(async (_key: string, fallback: unknown) => fallback),
  saveState: vi.fn(async () => {}),
  saveStateDebounced: vi.fn(() => {}),
  flushPendingSaves: vi.fn(async () => {}),
}));

import { history, historyLimit, historyPaused, addHistory, hydrate } from '../src/lib/stores';

function entry(id: string): HistoryEntry {
  return { id, protocol: 'http', request: { method: 'GET', url: `https://example.com/${id}`, headers: {} }, status: 200, at: Date.now() };
}

function getHistory(): HistoryEntry[] {
  let snapshot: HistoryEntry[] = [];
  const unsub = history.subscribe((v) => { snapshot = v; });
  unsub();
  return snapshot;
}

describe('history retention', () => {
  beforeEach(async () => {
    // Run once (idempotent via the `hydrated` guard) to register the
    // historyLimit truncation subscription, then reset stores to a clean slate.
    await hydrate();
    history.set([]);
    historyLimit.set(500);
    historyPaused.set(false);
  });

  it('records entries newest-first when not paused', () => {
    addHistory(entry('a'));
    addHistory(entry('b'));
    expect(getHistory().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('is a no-op while historyPaused is true', () => {
    historyPaused.set(true);
    addHistory(entry('a'));
    expect(getHistory()).toEqual([]);

    historyPaused.set(false);
    addHistory(entry('b'));
    expect(getHistory().map((e) => e.id)).toEqual(['b']);
  });

  it('caps stored entries at historyLimit, keeping the newest', () => {
    historyLimit.set(2);
    addHistory(entry('a'));
    addHistory(entry('b'));
    addHistory(entry('c'));
    expect(getHistory().map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('treats historyLimit 0 as unlimited', () => {
    historyLimit.set(0);
    for (const id of ['a', 'b', 'c', 'd', 'e']) addHistory(entry(id));
    expect(getHistory().map((e) => e.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('truncates existing entries when historyLimit is lowered', () => {
    historyLimit.set(0);
    for (const id of ['a', 'b', 'c', 'd', 'e']) addHistory(entry(id));
    expect(getHistory()).toHaveLength(5);

    historyLimit.set(2);
    expect(getHistory().map((e) => e.id)).toEqual(['e', 'd']);
  });
});
