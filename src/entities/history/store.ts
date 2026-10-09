import { get, writable } from 'svelte/store';
import type { HistoryEntry, Tab, GrpcTabState } from '$shared/model';
import { pushCapped } from './history';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl, tabs, activeTabId } from '$entities/tab';
import { environments, activeEnvironmentId } from '$entities/environment';

export const history = writable<HistoryEntry[]>([]);
// 0 = unlimited. Otherwise keep the last N history entries.
export const historyLimit = writable<number>(500);
// While true, new requests are not recorded into history.
export const historyPaused = writable<boolean>(false);

export function addHistory(entry: HistoryEntry): void {
  if (get(historyPaused)) return;
  const limit = get(historyLimit);
  const envName = entry.envName ?? get(environments).find((e) => e.id === get(activeEnvironmentId))?.name;
  history.update((h) => pushCapped(h, { ...entry, envName }, limit > 0 ? limit : Infinity));
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
    const grpc: GrpcTabState = grpcSnapshot(entry.grpc) ?? { endpoint: '', plaintext: true, message: '', metadata: {} };
    tab = {
      id: crypto.randomUUID(),
      protocol: 'grpc',
      title: entry.title ?? titleFromUrl(grpc.endpoint, GRPC_DEFAULT_TITLE),
      manualTitle: !!entry.title,
      request: { method: 'GRPC', url: '', headers: {} },
      grpc,
      historyId: entry.id,
    };
  } else {
    tab = {
      id: crypto.randomUUID(),
      protocol: 'http',
      title: entry.title ?? titleFromUrl(entry.request.url, HTTP_DEFAULT_TITLE),
      manualTitle: !!entry.title,
      // The draft as typed (with {{vars}}); the resolved copy is the fallback for old entries.
      request: structuredClone(entry.raw ?? entry.request),
      params: entry.params?.map((p) => ({ ...p })),
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

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
