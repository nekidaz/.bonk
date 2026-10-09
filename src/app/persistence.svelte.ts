import { untrack } from 'svelte';
import type { ProxyMode, Tab, HistoryEntry, TreeNode, Environment, VarRow } from '$shared/model';
import { type Flow, flows } from '$entities/flow';
import { loadState, saveState, saveStateDebounced } from '$shared/persist';
import { startupOpen, requestPrefs } from '$shared/settings';
import { workspaceLoad, secretGet, secretSet, secretDelete } from '$shared/ipc';
import { collectSecrets, mergeSecrets, secretAccountsOf, stripSecrets } from './secrets';
import { normalizeTabTitleState, stripRuntimeTab, tabs } from '$entities/tab';
import { history } from '$entities/history';
import {
  collapsedFolders,
  collectExpanded,
  normalizeWorkspaceRecents,
  rememberWorkspacePath,
  withSavedCollapse,
  workspace,
} from '$entities/workspace';
import { environments } from '$entities/environment';

let hydrated = false;

// Secret env vars live in the OS keychain; state.json gets them with value ''.
// `inKeychain` = account -> value last confirmed written (or read) there.
const inKeychain = new Map<string, string>();
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let secretChain: Promise<void> = Promise.resolve();

async function syncSecrets(): Promise<void> {
  const g = environments.globals;
  const e = environments.list;
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
 * Restore persisted state: tabs, history, settings, the
 * workspace tree, and the previously-focused tab. Nothing is saved
 * here — this is the one-shot restore half of hydrate().
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
  if (restoredTabs.length > 0 && startupOpen.current === 'last') tabs.list = restoredTabs;
  history.list = savedHistory;
  workspace.recent = normalizeWorkspaceRecents(savedRecentWorkspacePaths);
  history.limit = await loadState<number>('historyLimit', 500);
  history.paused = await loadState<boolean>('historyPaused', false);
  requestPrefs.responseLineWrap = await loadState<boolean>('responseLineWrap', true);
  requestPrefs.requestTimeoutMs = await loadState<number>('requestTimeoutMs', 30_000);
  requestPrefs.requestFollowRedirects = await loadState<boolean>('requestFollowRedirects', true);
  requestPrefs.requestValidateTls = await loadState<boolean>('requestValidateTls', true);
  requestPrefs.responseBodyLimitMb = await loadState<number>('responseBodyLimitMb', 25);
  requestPrefs.responsePrettyDefault = await loadState<boolean>('responsePrettyDefault', true);
  requestPrefs.proxyMode = await loadState<ProxyMode>('proxyMode', 'system');
  requestPrefs.proxyUrl = await loadState<string>('proxyUrl', '');
  requestPrefs.proxyBypass = await loadState<string>('proxyBypass', '');
  requestPrefs.trustedCaPaths = await loadState<string[]>('trustedCaPaths', []);
  requestPrefs.grpcDeadlineMs = await loadState<number>('grpcDeadlineMs', 30_000);
  requestPrefs.grpcAutoReflect = await loadState<boolean>('grpcAutoReflect', true);
  // Postman-style variables. The array fallbacks make loadState reject a corrupt
  // non-array value; activeEnvironmentId falls back to null (No environment).
  const loaded = await loadSecrets(
    await loadState<VarRow[]>('globals', []),
    await loadState<Environment[]>('environments', []),
  );
  environments.globals = loaded.globals;
  environments.list = loaded.envs;
  environments.activeId = await loadState<string | null>('activeEnvironmentId', null);
  flows.list = await loadState<Flow[]>('flows', []);
  Object.assign(collapsedFolders, await loadState<Record<string, string[]>>('collapsedFolders', {}));
  let nextTree: TreeNode[] = [];
  if (savedWorkspacePath) {
    try {
      nextTree = withSavedCollapse(savedWorkspacePath, await workspaceLoad(savedWorkspacePath));
      workspace.path = savedWorkspacePath;
      rememberWorkspacePath(savedWorkspacePath);
    } catch {
      workspace.path = '';
    }
  }
  workspace.tree = nextTree;
  // Restore the previously-focused tab if it still exists (git/project-diff tabs
  // aren't persisted, so fall back to the first tab when it doesn't).
  const savedActiveId = await loadState<string>('activeTabId', '');
  const currentTabs = tabs.list;
  tabs.activeId = currentTabs.some((t) => t.id === savedActiveId) ? savedActiveId : (currentTabs[0]?.id ?? '');
}

/**
 * Save state to disk on every change: one $effect per saved key, each re-runs (and saves) when
 * the state it reads changes, and once right away when wired.
 * Returns a teardown that stops them all. Production calls hydrate() once and never tears down;
 * the teardown exists for HMR / tests so the (single) live set can be re-armed.
 */
function wirePersistence(): () => void {
  return $effect.root(() => {
    // Persist requests, not live connections: a tab's gRPC connectionId/tree point
    // at a backend connection that's gone after a restart, so strip them. A restored
    // tab then reconnects on first use instead of failing with "unknown connection".
    // Special tabs (git diffs, the Environments manager, the Collection Runner) hold
    // no request state and are not persisted; restoreState's http/grpc whitelist
    // drops them on load too.
    $effect(() =>
      saveStateDebounced(
        'tabs',
        tabs.list
          .filter((tab) => tab.protocol !== 'git' && tab.protocol !== 'runner' && tab.protocol !== 'flow')
          .map(stripRuntimeTab),
      ),
    );
    $effect(() => saveStateDebounced('activeTabId', tabs.activeId));
    // Persist history immediately (not debounced): entries are low-frequency (one
    // per sent request) and the debounced write was being lost on app quit
    // (beforeunload is unreliable in the Tauri webview), so history "reset" on the
    // next launch. Writing on each change keeps the on-disk history current.
    // (Lowering history.limit trims the list itself, see entities/history.)
    $effect(() => void saveState('history', history.list));
    $effect(() => saveStateDebounced('historyLimit', history.limit));
    $effect(() => saveStateDebounced('historyPaused', history.paused));
    $effect(() => saveStateDebounced('workspacePath', workspace.path));
    // Remember collapsed folders per workspace root (the Rust load always expands all).
    // Runs on tree changes only: the root is read untracked.
    $effect(() => {
      const tree = workspace.tree;
      const root = untrack(() => workspace.path);
      if (!root) return;
      const expanded = new Map<string, boolean>();
      collectExpanded(tree, expanded);
      collapsedFolders[root] = [...expanded].filter(([, open]) => !open).map(([id]) => id);
      saveStateDebounced('collapsedFolders', collapsedFolders);
    });
    $effect(() => saveStateDebounced('recentWorkspacePaths', workspace.recent));
    // Variables go through the keychain sync (secrets out of state.json), which saves both keys.
    $effect(() => {
      void environments.globals;
      void environments.list;
      scheduleSecretSync();
    });
    $effect(() => saveStateDebounced('activeEnvironmentId', environments.activeId));
    $effect(() => saveStateDebounced('responseLineWrap', requestPrefs.responseLineWrap));
    $effect(() => saveStateDebounced('requestTimeoutMs', requestPrefs.requestTimeoutMs));
    $effect(() => saveStateDebounced('requestFollowRedirects', requestPrefs.requestFollowRedirects));
    $effect(() => saveStateDebounced('requestValidateTls', requestPrefs.requestValidateTls));
    $effect(() => saveStateDebounced('responseBodyLimitMb', requestPrefs.responseBodyLimitMb));
    $effect(() => saveStateDebounced('responsePrettyDefault', requestPrefs.responsePrettyDefault));
    $effect(() => saveStateDebounced('proxyMode', requestPrefs.proxyMode));
    $effect(() => saveStateDebounced('proxyUrl', requestPrefs.proxyUrl));
    $effect(() => saveStateDebounced('proxyBypass', requestPrefs.proxyBypass));
    $effect(() => saveStateDebounced('trustedCaPaths', requestPrefs.trustedCaPaths));
    $effect(() => saveStateDebounced('grpcDeadlineMs', requestPrefs.grpcDeadlineMs));
    $effect(() => saveStateDebounced('grpcAutoReflect', requestPrefs.grpcAutoReflect));
    $effect(() => saveStateDebounced('flows', flows.list));
  });
}

/**
 * Restore persisted state, then start saving it. Returns a
 * teardown that stops the saving and re-arms hydrate (for HMR / tests);
 * production calls this once on startup and never tears down.
 */
export async function hydrate(): Promise<() => void> {
  // Already hydrated: return a no-op teardown so the (single) live set of savers
  // is never torn down by a second caller.
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
// against freshly re-created (empty) state without anyone re-calling hydrate(),
// leaving the UI blank until a manual reload. Force a clean full reload so the
// normal startup path runs again. Stripped from production builds.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
