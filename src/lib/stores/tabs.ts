import { get } from 'svelte/store';
import { t } from '../i18n';
import type { GrpcTabState, Tab } from '../domain/types';
import { cancelRequest } from '../api';
import { busyMap, grpcErrorMap } from '../requestRuntime';
import { clearGrpcEditorSection } from '../grpcEditorUi';
import { parentId } from '../domain/tree';
import {
  GRPC_DEFAULT_TITLE,
  HTTP_DEFAULT_TITLE,
  grpcSnapshot,
  moveTabTo,
  newGrpcTab,
  newHttpTab,
  titleFromUrl,
} from '../domain/tab';
import { tabs, activeTabId, updateActiveTab, requestConfirm } from './state';
import { confirmCloseUnsaved } from './prefs';
import { dirtyTabIds } from './dirty';
import { saveActiveRequest } from './requests';

export function newTab(protocol: 'http' | 'grpc' = 'http'): void {
  const t = protocol === 'grpc' ? newGrpcTab() : newHttpTab();
  tabs.update((list) => [...list, t]);
  activeTabId.set(t.id);
}

export function moveTab(id: string, to: number): void {
  tabs.update((list) => moveTabTo(list, id, to));
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
  if (tab.protocol === 'git' || tab.protocol === 'env' || tab.protocol === 'runner') return;
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
    if (t.protocol === 'git' || t.protocol === 'env' || t.protocol === 'runner') return t;
    if (t.protocol === protocol) return t;
    if (protocol === 'grpc') {
      const grpc: GrpcTabState = t.grpc ?? {
        endpoint: '',
        plaintext: true,
        message: '',
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

// Most-recently-closed request tabs, for ⇧⌘T. Session-only.
let closedTabs: Tab[] = [];

/** Reopen the last closed request tab (⇧⌘T). Returns false when there is nothing to reopen. */
export function reopenClosedTab(): boolean {
  const [tab, ...rest] = closedTabs;
  if (!tab) return false;
  closedTabs = rest;
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
  return true;
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
  clearGrpcEditorSection(id);
  const next = list.filter((t) => t.id !== id);
  const closing = list[idx];
  if (closing.protocol === 'http' || closing.protocol === 'grpc') closedTabs = [closing, ...closedTabs].slice(0, 20);
  tabs.set(next);
  if (next.length === 0) {
    activeTabId.set('');
    return;
  }
  // If the closed tab was active, activate its neighbour (prefer the previous).
  if (get(activeTabId) === id) {
    const neighbour = next[Math.max(0, idx - 1)];
    activeTabId.set(neighbour.id);
  }
}

/** Close a tab from the UI: asks first when it has unsaved changes (Settings → Общие). */
export async function requestCloseTab(id: string): Promise<void> {
  if (get(confirmCloseUnsaved) && get(dirtyTabIds).has(id)) {
    const title = get(tabs).find((t) => t.id === id)?.title ?? '';
    if (!(await requestConfirm(get(t)('tabs.confirmClose', { title }), get(t)('common.close')))) return;
  }
  closeTab(id);
}

/**
 * Duplicate a tab in place (Postman's "Duplicate Tab"): a deep-enough copy of
 * the request state inserted right after the source, made active. The copy is
 * detached from disk (`savedPath` dropped — saving it must create a new file,
 * not overwrite the original) and from runtime state (response/test output and
 * the live gRPC connection are not carried over).
 */
export function duplicateTab(id: string): void {
  const list = get(tabs);
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const src = list[idx];
  // Special tabs (git diff / env manager / runner) are singletons — no duplicating.
  if (src.protocol === 'git' || src.protocol === 'env' || src.protocol === 'runner') return;
  const copy: Tab = {
    ...src,
    id: crypto.randomUUID(),
    request: { ...src.request, headers: { ...src.request.headers } },
    params: src.params?.map((p) => ({ ...p })),
    grpc: grpcSnapshot(src.grpc),
    savedPath: undefined,
    response: undefined,
    grpcResult: undefined,
    testResults: undefined,
  };
  tabs.update((l) => [...l.slice(0, idx + 1), copy, ...l.slice(idx + 1)]);
  activeTabId.set(copy.id);
}

/** Close every tab except `id` (which becomes active). Reuses closeTab so each closed tab's in-flight request/runtime state is cleaned up. */
export function closeOtherTabs(id: string): void {
  if (!get(tabs).some((t) => t.id === id)) return;
  activeTabId.set(id);
  for (const t of get(tabs)) {
    if (t.id !== id) closeTab(t.id);
  }
}

/** Close every tab; the main panel then shows the "no open tabs" screen. */
export function closeAllTabs(): void {
  for (const t of get(tabs)) closeTab(t.id);
}
