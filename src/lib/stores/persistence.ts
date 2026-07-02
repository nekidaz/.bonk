import { get } from 'svelte/store';
import type { Tab, HistoryEntry, TreeNode, Environment, VarRow } from '../domain/types';
import { loadState, saveState, saveStateDebounced } from '../persist';
import { workspaceLoad } from '../api';
import { normalizeTabTitleState, stripRuntimeTab } from '../domain/tab';
import {
  tabs,
  activeTabId,
  history,
  historyLimit,
  historyPaused,
  responseLineWrap,
  requestTimeoutMs,
  requestFollowRedirects,
  requestValidateTls,
  responseBodyLimitMb,
  collections,
  workspacePath,
  recentWorkspacePaths,
  globals,
  environments,
  activeEnvironmentId,
} from './state';
import { normalizeWorkspaceRecents, rememberWorkspacePath } from './workspace';

let hydrated = false;

/**
 * Restore persisted state into the stores: tabs, history, settings, the
 * workspace tree, and the previously-focused tab. No subscriptions are
 * registered here — this is the one-shot restore half of hydrate().
 */
async function restoreState(): Promise<void> {
  // loadState verifies the value is an array when the fallback is one, so a
  // corrupt/non-array persisted value falls back to [] instead of crashing.
  const savedTabs = await loadState<Tab[]>('tabs', []);
  const savedHistory = await loadState<HistoryEntry[]>('history', []);
  const savedWorkspacePath = await loadState<string>('workspacePath', '');
  const savedRecentWorkspacePaths = await loadState<string[]>('recentWorkspacePaths', []);
  const restoredTabs = savedTabs
    .filter((tab) => tab && (tab.protocol === 'http' || tab.protocol === 'grpc'))
    .map(normalizeTabTitleState)
    .map(stripRuntimeTab);
  if (restoredTabs.length > 0) tabs.set(restoredTabs);
  history.set(savedHistory);
  recentWorkspacePaths.set(normalizeWorkspaceRecents(savedRecentWorkspacePaths));
  historyLimit.set(await loadState<number>('historyLimit', 500));
  historyPaused.set(await loadState<boolean>('historyPaused', false));
  responseLineWrap.set(await loadState<boolean>('responseLineWrap', true));
  requestTimeoutMs.set(await loadState<number>('requestTimeoutMs', 30_000));
  requestFollowRedirects.set(await loadState<boolean>('requestFollowRedirects', true));
  requestValidateTls.set(await loadState<boolean>('requestValidateTls', true));
  responseBodyLimitMb.set(await loadState<number>('responseBodyLimitMb', 25));
  // Postman-style variables. The array fallbacks make loadState reject a corrupt
  // non-array value; activeEnvironmentId falls back to null (No environment).
  globals.set(await loadState<VarRow[]>('globals', []));
  environments.set(await loadState<Environment[]>('environments', []));
  activeEnvironmentId.set(await loadState<string | null>('activeEnvironmentId', null));
  let nextTree: TreeNode[] = [];
  if (savedWorkspacePath) {
    try {
      nextTree = await workspaceLoad(savedWorkspacePath);
      workspacePath.set(savedWorkspacePath);
      rememberWorkspacePath(savedWorkspacePath);
    } catch {
      workspacePath.set('');
    }
  }
  collections.set(nextTree);
  // Restore the previously-focused tab if it still exists (git/project-diff tabs
  // aren't persisted, so fall back to the first tab when it doesn't).
  const savedActiveId = await loadState<string>('activeTabId', '');
  const currentTabs = get(tabs);
  activeTabId.set(
    currentTabs.some((t) => t.id === savedActiveId) ? savedActiveId : (currentTabs[0]?.id ?? ''),
  );
}

/**
 * Wire the store→disk persistence subscriptions and return a teardown that drops
 * them all. Production calls hydrate() once and never tears down; the teardown
 * exists for HMR / tests so the (single) live subscription set can be re-armed.
 */
function wirePersistence(): () => void {
  const unsubs = [
    // Persist requests, not live connections: a tab's gRPC connectionId/tree point
    // at a backend connection that's gone after a restart, so strip them. A restored
    // tab then reconnects on first use instead of failing with "unknown connection".
    // Special tabs (git diffs, the Environments manager, the Collection Runner) hold
    // no request state and are not persisted; restoreState's http/grpc whitelist
    // drops them on load too.
    tabs.subscribe((t) => saveStateDebounced('tabs', t.filter((tab) => tab.protocol !== 'git' && tab.protocol !== 'env' && tab.protocol !== 'runner').map(stripRuntimeTab))),
    activeTabId.subscribe((id) => saveStateDebounced('activeTabId', id)),
    // Persist history immediately (not debounced): entries are low-frequency (one
    // per sent request) and the debounced write was being lost on app quit
    // (beforeunload is unreliable in the Tauri webview), so history "reset" on the
    // next launch. Writing on each change keeps the on-disk history current.
    history.subscribe((h) => void saveState('history', h)),
    workspacePath.subscribe((p) => saveStateDebounced('workspacePath', p)),
    recentWorkspacePaths.subscribe((paths) => saveStateDebounced('recentWorkspacePaths', paths)),
    historyLimit.subscribe((n) => { if (n > 0) history.update((h) => h.slice(0, n)); }),
    historyLimit.subscribe((n) => saveStateDebounced('historyLimit', n)),
    historyPaused.subscribe((p) => saveStateDebounced('historyPaused', p)),
    responseLineWrap.subscribe((v) => saveStateDebounced('responseLineWrap', v)),
    requestTimeoutMs.subscribe((n) => saveStateDebounced('requestTimeoutMs', n)),
    requestFollowRedirects.subscribe((v) => saveStateDebounced('requestFollowRedirects', v)),
    requestValidateTls.subscribe((v) => saveStateDebounced('requestValidateTls', v)),
    responseBodyLimitMb.subscribe((n) => saveStateDebounced('responseBodyLimitMb', n)),
    globals.subscribe((v) => saveStateDebounced('globals', v)),
    environments.subscribe((v) => saveStateDebounced('environments', v)),
    activeEnvironmentId.subscribe((id) => saveStateDebounced('activeEnvironmentId', id)),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

/**
 * Restore persisted state, then wire the persistence subscriptions. Returns a
 * teardown that drops the subscriptions and re-arms hydrate (for HMR / tests);
 * production calls this once on startup and never tears down.
 */
export async function hydrate(): Promise<() => void> {
  // Already hydrated: return a no-op teardown so the (single) live subscription
  // set is never torn down by a second caller.
  if (hydrated) return () => {};
  hydrated = true;
  await restoreState();
  const unwire = wirePersistence();
  return () => {
    unwire();
    hydrated = false;
  };
}

// --- HMR (dev only) ---
// hydrate() is a one-shot (the `hydrated` guard) called once from App.onMount. A
// partial HMR swap of this module resets the guard and re-wires persistence
// against freshly re-created (empty) stores without anyone re-calling hydrate(),
// leaving the UI blank until a manual reload. Force a clean full reload so the
// normal startup path runs again. Stripped from production builds.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
