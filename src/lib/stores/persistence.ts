import { derived, get } from 'svelte/store';
import type { ProxyMode, Tab, HistoryEntry, TreeNode, Environment, VarRow } from '../domain/types';
import type { Flow } from '../domain/flow';
import { loadState, saveState, saveStateDebounced } from '../persist';
import { startupOpen } from './prefs';
import { workspaceLoad, secretGet, secretSet, secretDelete } from '../api';
import { collectSecrets, mergeSecrets, secretAccountsOf, stripSecrets } from '../domain/secrets';
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
  responsePrettyDefault,
  proxyMode,
  proxyUrl,
  proxyBypass,
  trustedCaPaths,
  grpcDeadlineMs,
  grpcAutoReflect,
  collections,
  workspacePath,
  recentWorkspacePaths,
  globals,
  environments,
  activeEnvironmentId,
  flows,
} from './state';
import {
  collapsedFolders,
  collectExpanded,
  normalizeWorkspaceRecents,
  rememberWorkspacePath,
  withSavedCollapse,
} from './workspace';

let hydrated = false;

// Secret env vars live in the OS keychain; state.json gets them with value ''.
// `inKeychain` = account -> value last confirmed written (or read) there.
const inKeychain = new Map<string, string>();
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let secretChain: Promise<void> = Promise.resolve();

async function syncSecrets(): Promise<void> {
  const g = get(globals);
  const e = get(environments);
  const want = collectSecrets(g, e);
  for (const [account, value] of want) {
    if (inKeychain.get(account) === value) continue;
    try {
      await secretSet(account, value);
      inKeychain.set(account, value);
    } catch (err) {
      // Keep the value in state.json (not stripped) so it is never lost.
      inKeychain.delete(account);
      console.warn(`keychain: could not store secret "${account}"; keeping it in app state`, err);
    }
  }
  // Renamed / un-marked / deleted secrets: drop their keychain entries.
  for (const account of [...inKeychain.keys()]) {
    if (want.has(account)) continue;
    try {
      await secretDelete(account);
      inKeychain.delete(account);
    } catch (err) {
      console.warn(`keychain: could not delete "${account}"`, err);
    }
  }
  const out = stripSecrets(g, e, new Set(inKeychain.keys()));
  saveStateDebounced('globals', out.globals);
  saveStateDebounced('environments', out.envs);
}

function scheduleSecretSync(): void {
  clearTimeout(secretTimer);
  secretTimer = setTimeout(() => {
    secretChain = secretChain.then(syncSecrets).catch((err) => console.error('keychain sync failed', err));
  }, 350);
}

/** Fill secret values from the keychain; legacy plain values stay and migrate on the first sync. */
async function loadSecrets(g: VarRow[], envs: Environment[]) {
  const found = new Map<string, string>();
  for (const account of secretAccountsOf(g, envs)) {
    try {
      const v = await secretGet(account);
      if (v !== null) {
        found.set(account, v);
        inKeychain.set(account, v);
      }
    } catch (err) {
      console.warn(`keychain: could not read "${account}"`, err);
    }
  }
  return mergeSecrets(g, envs, found);
}

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
    .filter((tab) => tab && (tab.protocol === 'http' || tab.protocol === 'grpc' || tab.protocol === 'env'))
    .map(normalizeTabTitleState)
    .map(stripRuntimeTab);
  await startupOpen.ready;
  if (restoredTabs.length > 0 && get(startupOpen) === 'last') tabs.set(restoredTabs);
  history.set(savedHistory);
  recentWorkspacePaths.set(normalizeWorkspaceRecents(savedRecentWorkspacePaths));
  historyLimit.set(await loadState<number>('historyLimit', 500));
  historyPaused.set(await loadState<boolean>('historyPaused', false));
  responseLineWrap.set(await loadState<boolean>('responseLineWrap', true));
  requestTimeoutMs.set(await loadState<number>('requestTimeoutMs', 30_000));
  requestFollowRedirects.set(await loadState<boolean>('requestFollowRedirects', true));
  requestValidateTls.set(await loadState<boolean>('requestValidateTls', true));
  responseBodyLimitMb.set(await loadState<number>('responseBodyLimitMb', 25));
  responsePrettyDefault.set(await loadState<boolean>('responsePrettyDefault', true));
  proxyMode.set(await loadState<ProxyMode>('proxyMode', 'system'));
  proxyUrl.set(await loadState<string>('proxyUrl', ''));
  proxyBypass.set(await loadState<string>('proxyBypass', ''));
  trustedCaPaths.set(await loadState<string[]>('trustedCaPaths', []));
  grpcDeadlineMs.set(await loadState<number>('grpcDeadlineMs', 30_000));
  grpcAutoReflect.set(await loadState<boolean>('grpcAutoReflect', true));
  // Postman-style variables. The array fallbacks make loadState reject a corrupt
  // non-array value; activeEnvironmentId falls back to null (No environment).
  const loaded = await loadSecrets(
    await loadState<VarRow[]>('globals', []),
    await loadState<Environment[]>('environments', []),
  );
  globals.set(loaded.globals);
  environments.set(loaded.envs);
  activeEnvironmentId.set(await loadState<string | null>('activeEnvironmentId', null));
  flows.set(await loadState<Flow[]>('flows', []));
  Object.assign(collapsedFolders, await loadState<Record<string, string[]>>('collapsedFolders', {}));
  let nextTree: TreeNode[] = [];
  if (savedWorkspacePath) {
    try {
      nextTree = withSavedCollapse(savedWorkspacePath, await workspaceLoad(savedWorkspacePath));
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
  activeTabId.set(currentTabs.some((t) => t.id === savedActiveId) ? savedActiveId : (currentTabs[0]?.id ?? ''));
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
    tabs.subscribe((t) =>
      saveStateDebounced(
        'tabs',
        t
          .filter((tab) => tab.protocol !== 'git' && tab.protocol !== 'runner' && tab.protocol !== 'flow')
          .map(stripRuntimeTab),
      ),
    ),
    activeTabId.subscribe((id) => saveStateDebounced('activeTabId', id)),
    // Persist history immediately (not debounced): entries are low-frequency (one
    // per sent request) and the debounced write was being lost on app quit
    // (beforeunload is unreliable in the Tauri webview), so history "reset" on the
    // next launch. Writing on each change keeps the on-disk history current.
    history.subscribe((h) => void saveState('history', h)),
    workspacePath.subscribe((p) => saveStateDebounced('workspacePath', p)),
    // Remember collapsed folders per workspace root (the Rust load always expands all).
    collections.subscribe((tree) => {
      const root = get(workspacePath);
      if (!root) return;
      const expanded = new Map<string, boolean>();
      collectExpanded(tree, expanded);
      collapsedFolders[root] = [...expanded].filter(([, open]) => !open).map(([id]) => id);
      saveStateDebounced('collapsedFolders', collapsedFolders);
    }),
    recentWorkspacePaths.subscribe((paths) => saveStateDebounced('recentWorkspacePaths', paths)),
    historyLimit.subscribe((n) => {
      if (n > 0) history.update((h) => h.slice(0, n));
    }),
    historyLimit.subscribe((n) => saveStateDebounced('historyLimit', n)),
    historyPaused.subscribe((p) => saveStateDebounced('historyPaused', p)),
    responseLineWrap.subscribe((v) => saveStateDebounced('responseLineWrap', v)),
    requestTimeoutMs.subscribe((n) => saveStateDebounced('requestTimeoutMs', n)),
    requestFollowRedirects.subscribe((v) => saveStateDebounced('requestFollowRedirects', v)),
    requestValidateTls.subscribe((v) => saveStateDebounced('requestValidateTls', v)),
    responseBodyLimitMb.subscribe((n) => saveStateDebounced('responseBodyLimitMb', n)),
    responsePrettyDefault.subscribe((v) => saveStateDebounced('responsePrettyDefault', v)),
    proxyMode.subscribe((v) => saveStateDebounced('proxyMode', v)),
    proxyUrl.subscribe((v) => saveStateDebounced('proxyUrl', v)),
    proxyBypass.subscribe((v) => saveStateDebounced('proxyBypass', v)),
    trustedCaPaths.subscribe((v) => saveStateDebounced('trustedCaPaths', v)),
    grpcDeadlineMs.subscribe((n) => saveStateDebounced('grpcDeadlineMs', n)),
    grpcAutoReflect.subscribe((v) => saveStateDebounced('grpcAutoReflect', v)),
    derived([globals, environments], (v) => v).subscribe(scheduleSecretSync),
    activeEnvironmentId.subscribe((id) => saveStateDebounced('activeEnvironmentId', id)),
    flows.subscribe((v) => saveStateDebounced('flows', v)),
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
