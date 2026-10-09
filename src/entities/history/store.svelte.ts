import { untrack } from 'svelte';
import type { HistoryEntry, Tab, GrpcTabState } from '$shared/model';
import { pushCapped } from './history';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl, tabs } from '$entities/tab';
import { environments } from '$entities/environment';

/** Sent requests, newest first. */
class History {
  /** The entries. Replaced, never mutated in place. */
  list = $state.raw<HistoryEntry[]>([]);
  /** While true, new requests are not recorded. */
  paused = $state(false);
  #limit = $state(500);

  /** Keep at most this many entries; 0 = unlimited. */
  get limit(): number {
    return this.#limit;
  }

  /** Lowering the limit drops the oldest entries right away. */
  set limit(n: number) {
    this.#limit = n;
    if (n > 0) this.list = untrack(() => this.list).slice(0, n);
  }
}
export const history = new History();

export function addHistory(entry: HistoryEntry): void {
  if (history.paused) return;
  const limit = history.limit;
  const envName = entry.envName ?? environments.active?.name;
  history.list = pushCapped(history.list, { ...entry, envName }, limit > 0 ? limit : Infinity);
}

/** Open a history entry in a new tab so it can be edited and re-sent. */
export function openHistoryEntry(entry: HistoryEntry): void {
  // Re-selecting the same history entry focuses its already-open tab instead of
  // spawning a duplicate (mirrors openSavedRequest's reuse-by-savedPath).
  const open = tabs.list.find((t) => t.historyId === entry.id);
  if (open) {
    tabs.activeId = open.id;
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
  tabs.activeId = tab.id;
}

export function clearHistory(): void {
  history.list = [];
}

export function removeHistoryEntry(id: string): void {
  history.list = history.list.filter((e) => e.id !== id);
}

// HMR (dev only): app/persistence.ts hydrate() fills these singletons once at startup.
// A partial hot swap would recreate them EMPTY, so force a full reload instead.
// Stripped from production builds, where import.meta.hot is undefined.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
