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
  tabsToClose,
  titleFromUrl,
  switchedProtocol,
  togglePinned,
} from '../domain/tab';
import { tabs, activeTabId, updateActiveTab, requestConfirm, requestChoice, requestSaveDialog } from './state';
import { confirmCloseUnsaved } from './prefs';
import { dirtyTabIds } from './dirty';
import { saveActiveRequest } from './requests';
import { renameNode } from './workspace';

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
  // A saved request is renamed on disk right away (like the sidebar's Rename);
  // other unsaved edits stay unsaved until ⌘S.
  if (tab.savedPath) void renameNode(tab.savedPath, clean);
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

/** P3/P4: switch the active tab between HTTP and gRPC — it becomes an empty request of the new type. Returns the tab as it was (for undo), or undefined when nothing changed. */
export function setActiveProtocol(protocol: 'http' | 'grpc'): Tab | undefined {
  const t = get(tabs).find((x) => x.id === get(activeTabId));
  if (!t || t.protocol === protocol || (t.protocol !== 'http' && t.protocol !== 'grpc')) return undefined;
  const next = switchedProtocol(t, protocol);
  tabs.update((list) => list.map((x) => (x.id === t.id ? next : x)));
  return t;
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

/**
 * Close a tab from the UI. With unsaved changes (Settings → Общие) it asks
 * Save / Don't save / Cancel, like Postman; Save on a never-saved tab opens the
 * save-to dialog and the tab closes only once the request is written.
 */
export async function requestCloseTab(id: string): Promise<void> {
  const tab = get(tabs).find((x) => x.id === id);
  if (tab && get(confirmCloseUnsaved) && get(dirtyTabIds).has(id)) {
    const choice = await requestChoice(
      get(t)('tabs.confirmClose', { title: tab.title }),
      get(t)('common.save'),
      get(t)('tabs.dontSave'),
    );
    if (choice === false) return;
    if (choice === true) {
      activeTabId.set(id); // save works on the active tab
      try {
        if (tab.savedPath) await saveActiveRequest(parentId(tab.savedPath), tab.title);
        else if (!(await requestSaveDialog())) return;
      } catch {
        return; // save failed: keep the tab and its edits
      }
    }
  }
  closeTab(id);
}

/** Bulk close: one confirm for every tab in `ids` with unsaved changes, then close them all. */
async function closeTabs(ids: string[]): Promise<void> {
  const dirty = get(dirtyTabIds);
  const n = ids.filter((id) => dirty.has(id)).length;
  if (
    n &&
    get(confirmCloseUnsaved) &&
    !(await requestConfirm(get(t)('tabs.confirmCloseMany', { n }), get(t)('tabs.closeWithoutSaving')))
  )
    return;
  for (const id of ids) closeTab(id);
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

/** Close every unpinned tab except `id` (which becomes active). Reuses closeTab so each closed tab's in-flight request/runtime state is cleaned up. */
export async function closeOtherTabs(id: string): Promise<void> {
  if (!get(tabs).some((t) => t.id === id)) return;
  activeTabId.set(id);
  await closeTabs(tabsToClose(get(tabs), id, 'others'));
}

/** S17b: close the unpinned tabs to the right of `id`. */
export async function closeTabsToRight(id: string): Promise<void> {
  await closeTabs(tabsToClose(get(tabs), id, 'right'));
}

/** S17b: pin / unpin `id`; pinned tabs lead the strip. */
export function togglePinTab(id: string): void {
  tabs.update((list) => togglePinned(list, id));
}

/** Close every unpinned tab; with none pinned the main panel shows the "no open tabs" screen. */
export async function closeAllTabs(): Promise<void> {
  await closeTabs(tabsToClose(get(tabs), '', 'all'));
}
