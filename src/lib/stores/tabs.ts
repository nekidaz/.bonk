import { get } from 'svelte/store';
import type { GrpcTabState } from '../domain/types';
import { cancelRequest } from '../api';
import { busyMap, grpcErrorMap } from '../requestRuntime';
import { parentId } from '../domain/tree';
import {
  GRPC_DEFAULT_TITLE,
  HTTP_DEFAULT_TITLE,
  newGrpcTab,
  newHttpTab,
  titleFromUrl,
} from '../domain/tab';
import { tabs, activeTabId, updateActiveTab } from './state';
import { saveActiveRequest } from './requests';

export function newTab(protocol: 'http' | 'grpc' = 'http'): void {
  const t = protocol === 'grpc' ? newGrpcTab() : newHttpTab();
  tabs.update((list) => [...list, t]);
  activeTabId.set(t.id);
}

export function renameActiveTab(name: string): void {
  const clean = name.trim();
  if (!clean) return;
  const tab = get(tabs).find((t) => t.id === get(activeTabId));
  if (!tab) return;
  tabs.update((list) => list.map((t) => (t.id === tab.id ? { ...t, title: clean, manualTitle: true } : t)));
  // If this request is already saved to disk, persist the rename immediately
  // (name + current edits) into its existing folder — no separate Save needed.
  if (tab.savedPath) {
    void saveActiveRequest(parentId(tab.savedPath), clean);
  }
}

export function resetActiveTabTitle(): void {
  const tab = get(tabs).find((t) => t.id === get(activeTabId));
  if (!tab) return;
  if (tab.protocol === 'git') return;
  const title =
    tab.protocol === 'grpc'
      ? titleFromUrl(tab.grpc?.endpoint ?? '', GRPC_DEFAULT_TITLE)
      : titleFromUrl(tab.request.url, HTTP_DEFAULT_TITLE);
  tabs.update((list) => list.map((t) => (t.id === tab.id ? { ...t, title, manualTitle: false } : t)));
}

/**
 * Switch the active tab between HTTP and gRPC in place, seeding the protocol's
 * state on first switch. Frontend-only; the App shell re-renders the matching
 * bar/editor for the new protocol. Manually renamed tabs keep their title;
 * unnamed tabs keep deriving title from the active URL/endpoint.
 */
export function setActiveProtocol(protocol: 'http' | 'grpc'): void {
  updateActiveTab((t) => {
    if (t.protocol === 'git') return t;
    if (t.protocol === protocol) return t;
    if (protocol === 'grpc') {
      const grpc: GrpcTabState = t.grpc ?? {
        endpoint: '',
        plaintext: true,
        message: '{}',
        metadata: {},
      };
      return {
        ...t,
        protocol: 'grpc',
        title: t.manualTitle ? t.title : titleFromUrl(grpc.endpoint, GRPC_DEFAULT_TITLE),
        request: { ...t.request, method: 'GRPC' },
        grpc,
      };
    }
    return {
      ...t,
      protocol: 'http',
      title: t.manualTitle ? t.title : titleFromUrl(t.request.url, HTTP_DEFAULT_TITLE),
      request: { ...t.request, method: t.request.method === 'GRPC' ? 'GET' : t.request.method },
    };
  });
}

export function closeTab(id: string): void {
  const list = get(tabs);
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  // Cancel any in-flight request for this tab and drop its runtime state so a
  // closed tab can't leave an orphaned backend request or leak busy/error maps.
  const busy = get(busyMap)[id];
  if (busy?.requestId) void cancelRequest(busy.requestId);
  busyMap.update((m) => {
    if (!(id in m)) return m;
    const { [id]: _b, ...rest } = m;
    return rest;
  });
  grpcErrorMap.update((m) => {
    if (!(id in m)) return m;
    const { [id]: _e, ...rest } = m;
    return rest;
  });
  const next = list.filter((t) => t.id !== id);
  // Never leave the workspace tab-less: spawn a fresh HTTP tab if the last
  // tab was closed.
  if (next.length === 0) {
    const fresh = newHttpTab();
    tabs.set([fresh]);
    activeTabId.set(fresh.id);
    return;
  }
  tabs.set(next);
  // If the closed tab was active, activate its neighbour (prefer the previous).
  if (get(activeTabId) === id) {
    const neighbour = next[Math.max(0, idx - 1)];
    activeTabId.set(neighbour.id);
  }
}
