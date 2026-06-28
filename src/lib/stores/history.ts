import { get } from 'svelte/store';
import type { HistoryEntry, Tab, GrpcTabState } from '../domain/types';
import { pushCapped } from '../domain/history';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl } from '../domain/tab';
import { tabs, activeTabId, history, historyLimit, historyPaused } from './state';

export function addHistory(entry: HistoryEntry): void {
  if (get(historyPaused)) return;
  const limit = get(historyLimit);
  history.update((h) => pushCapped(h, entry, limit > 0 ? limit : Infinity));
}

/** Open a history entry in a new tab so it can be edited and re-sent. */
export function openHistoryEntry(entry: HistoryEntry): void {
  // Re-selecting the same history entry focuses its already-open tab instead of
  // spawning a duplicate (mirrors openSavedRequest's reuse-by-savedPath).
  const open = get(tabs).find((t) => t.historyId === entry.id);
  if (open) {
    activeTabId.set(open.id);
    return;
  }
  let tab: Tab;
  if (entry.protocol === 'grpc') {
    const grpc: GrpcTabState =
      grpcSnapshot(entry.grpc) ?? { endpoint: '', plaintext: true, message: '{}', metadata: {} };
    tab = {
      id: crypto.randomUUID(),
      protocol: 'grpc',
      title: titleFromUrl(grpc.endpoint, GRPC_DEFAULT_TITLE),
      manualTitle: false,
      request: { method: 'GRPC', url: '', headers: {} },
      grpc,
      historyId: entry.id,
    };
  } else {
    tab = {
      id: crypto.randomUUID(),
      protocol: 'http',
      title: titleFromUrl(entry.request.url, HTTP_DEFAULT_TITLE),
      manualTitle: false,
      request: { ...entry.request, headers: { ...entry.request.headers } },
      historyId: entry.id,
    };
  }
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

export function clearHistory(): void {
  history.set([]);
}

export function removeHistoryEntry(id: string): void {
  history.update((h) => h.filter((e) => e.id !== id));
}
