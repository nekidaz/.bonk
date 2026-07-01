import { writable, get } from 'svelte/store';
import type { Tab, HistoryEntry, TreeNode, Environment, VarRow } from '../domain/types';
import { newHttpTab } from '../domain/tab';
import { mergeScope } from '../domain/vars';

/**
 * Core store singletons and the lowest-level tab mutators. Feature modules
 * (tabs / workspace / requests / history / git / persistence) all depend on this
 * module and never on each other for these primitives, which keeps the import
 * graph acyclic.
 */

/** fs root rel path. Shared by every workspace/request operation. */
export const ROOT = '';

const initialTab = newHttpTab();
export const tabs = writable<Tab[]>([initialTab]);
export const activeTabId = writable<string>(initialTab.id);
export const history = writable<HistoryEntry[]>([]);
// 0 = unlimited. Otherwise keep the last N history entries.
export const historyLimit = writable<number>(500);
// While true, new requests are not recorded into history.
export const historyPaused = writable<boolean>(false);
// Pretty response viewers wrap long lines by default; Raw can still be copied unchanged.
export const responseLineWrap = writable<boolean>(true);
// Global request behavior mirrors Postman-style app settings.
export const requestTimeoutMs = writable<number>(30_000);
export const requestFollowRedirects = writable<boolean>(true);
export const requestValidateTls = writable<boolean>(true);
export const responseBodyLimitMb = writable<number>(25);
export const collections = writable<TreeNode[]>([]);
export const workspacePath = writable<string>('');
export const recentWorkspacePaths = writable<string[]>([]);

// Postman-style variables. Globals apply everywhere; the active environment's
// vars override globals. These live in app-state (persist), NOT workspace files,
// so secrets don't leak into shared collection files.
export const globals = writable<VarRow[]>([]);
export const environments = writable<Environment[]>([]);
export const activeEnvironmentId = writable<string | null>(null);

/**
 * The current `{{var}}` resolution scope: globals merged with the active
 * environment (env overrides globals). Read on send / codegen to interpolate
 * placeholders. Returns a plain `name → value` map.
 */
export function currentVarScope(): Record<string, string> {
  const activeId = get(activeEnvironmentId);
  const active = activeId ? get(environments).find((e) => e.id === activeId) : undefined;
  return mergeScope(get(globals), active);
}

/** One-shot confirm dialog state; `null` when no dialog is open. */
export const confirmState = writable<{ message: string; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null);

/** Show an in-app confirm modal (the Tauri webview has no window.confirm). */
export function requestConfirm(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  // Resolve any still-open confirm as cancelled so its awaiter never hangs.
  get(confirmState)?.resolve(false);
  return new Promise((resolve) => confirmState.set({ message, confirmLabel, resolve }));
}

export function updateActiveTab(fn: (tab: Tab) => Tab): void {
  const id = get(activeTabId);
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

/** Update a specific tab by id, regardless of which tab is currently active. */
export function updateTabById(id: string, fn: (tab: Tab) => Tab): void {
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}
