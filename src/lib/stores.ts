import { writable, get } from 'svelte/store';
import type {
  GitDiffMode,
  Tab,
  HistoryEntry,
  GrpcTabState,
  TreeNode,
  RequestNode,
  HttpRequest,
  RequestSettings,
} from './domain/types';
import { pushCapped } from './domain/history';
import { loadState, saveState, saveStateDebounced } from './persist';
import {
  httpSend,
  workspaceLoad,
  workspacePickFolder,
  workspaceCreateFolder,
  workspaceSaveRequest,
  workspaceDelete,
  workspaceRename,
  workspaceDuplicate,
  workspaceMove,
  cancelRequest,
} from './api';
import { busyMap, grpcErrorMap } from './requestRuntime';
import { idToRel, parentId, findNode } from './domain/tree';
import { grpcPathsToRel, grpcPathsToAbs } from './domain/protoPaths';
import { parseCurl } from './domain/curl';
import { paramsFromUrl } from './domain/http';

export const HTTP_DEFAULT_TITLE = 'Untitled Request';
export const GRPC_DEFAULT_TITLE = 'New gRPC';
const LEGACY_DEFAULT_TITLES = new Set(['New Request', HTTP_DEFAULT_TITLE, GRPC_DEFAULT_TITLE]);

function newHttpTab(): Tab {
  return {
    id: crypto.randomUUID(),
    protocol: 'http',
    title: HTTP_DEFAULT_TITLE,
    manualTitle: false,
    request: { method: 'GET', url: '', headers: {} },
  };
}

function newGrpcTab(): Tab {
  const grpc: GrpcTabState = { endpoint: '', plaintext: true, message: '{}', metadata: {} };
  return {
    id: crypto.randomUUID(),
    protocol: 'grpc',
    title: GRPC_DEFAULT_TITLE,
    manualTitle: false,
    request: { method: 'GRPC', url: '', headers: {} },
    grpc,
  };
}

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

/** One-shot confirm dialog state; `null` when no dialog is open. */
export const confirmState = writable<{ message: string; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null);

/** Show an in-app confirm modal (the Tauri webview has no window.confirm). */
export function requestConfirm(message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  // Resolve any still-open confirm as cancelled so its awaiter never hangs.
  get(confirmState)?.resolve(false);
  return new Promise((resolve) => confirmState.set({ message, confirmLabel, resolve }));
}

const ROOT = ''; // fs root rel path
let hydrated = false;

export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const savedTabs = await loadState<Tab[]>('tabs', []);
  const savedHistory = await loadState<HistoryEntry[]>('history', []);
  const savedWorkspacePath = await loadState<string>('workspacePath', '');
  const savedRecentWorkspacePaths = await loadState<string[]>('recentWorkspacePaths', []);
  const restoredTabs = savedTabs
    .filter((tab) => tab.protocol === 'http' || tab.protocol === 'grpc')
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
  // Persist requests, not live connections: a tab's gRPC connectionId/tree point
  // at a backend connection that's gone after a restart, so strip them. A restored
  // tab then reconnects on first use instead of failing with "unknown connection".
  tabs.subscribe((t) => saveStateDebounced('tabs', t.filter((tab) => tab.protocol !== 'git').map(stripRuntimeTab)));
  activeTabId.subscribe((id) => saveStateDebounced('activeTabId', id));
  // Persist history immediately (not debounced): entries are low-frequency (one
  // per sent request) and the debounced write was being lost on app quit
  // (beforeunload is unreliable in the Tauri webview), so history "reset" on the
  // next launch. Writing on each change keeps the on-disk history current.
  history.subscribe((h) => void saveState('history', h));
  workspacePath.subscribe((p) => saveStateDebounced('workspacePath', p));
  recentWorkspacePaths.subscribe((paths) => saveStateDebounced('recentWorkspacePaths', paths));
  historyLimit.subscribe((n) => { if (n > 0) history.update((h) => h.slice(0, n)); });
  historyLimit.subscribe((n) => saveStateDebounced('historyLimit', n));
  historyPaused.subscribe((p) => saveStateDebounced('historyPaused', p));
  responseLineWrap.subscribe((v) => saveStateDebounced('responseLineWrap', v));
  requestTimeoutMs.subscribe((n) => saveStateDebounced('requestTimeoutMs', n));
  requestFollowRedirects.subscribe((v) => saveStateDebounced('requestFollowRedirects', v));
  requestValidateTls.subscribe((v) => saveStateDebounced('requestValidateTls', v));
  responseBodyLimitMb.subscribe((n) => saveStateDebounced('responseBodyLimitMb', n));
}

function normalizeWorkspaceRecents(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean))).slice(0, 10);
}

function rememberWorkspacePath(path: string): void {
  const clean = path.trim();
  if (!clean) return;
  recentWorkspacePaths.update((paths) => normalizeWorkspaceRecents([clean, ...paths]));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function currentRequestSettings(): RequestSettings {
  const timeoutMs = clampInt(get(requestTimeoutMs), 0, 600_000, 30_000);
  const maxResponseBodyMb = clampInt(get(responseBodyLimitMb), 1, 250, 25);
  return {
    timeoutMs,
    followRedirects: get(requestFollowRedirects),
    validateTls: get(requestValidateTls),
    maxResponseBodyBytes: maxResponseBodyMb * 1024 * 1024,
  };
}

/** Collect the expanded state of every folder, keyed by id, into `acc`. */
function collectExpanded(nodes: TreeNode[], acc: Map<string, boolean>): void {
  for (const n of nodes) if (n.kind === 'folder') { acc.set(n.id, n.expanded); collectExpanded(n.children, acc); }
}

/** Re-apply a saved expanded-by-id map to a freshly loaded tree; unknown folders keep the loaded default. */
function applyExpanded(nodes: TreeNode[], map: Map<string, boolean>): TreeNode[] {
  return nodes.map((n) => n.kind === 'folder'
    ? { ...n, expanded: map.has(n.id) ? map.get(n.id)! : n.expanded, children: applyExpanded(n.children, map) }
    : n);
}

async function reloadWorkspace(): Promise<void> {
  const path = get(workspacePath);
  if (!path) return;
  // The Rust `load` always returns folders expanded:true. Preserve the user's
  // current collapse state across the reload instead of re-expanding everything.
  const tree = await workspaceLoad(path);
  const expanded = new Map<string, boolean>();
  collectExpanded(get(collections), expanded);
  collections.set(applyExpanded(tree, expanded));
  // Defensive: a tab whose savedPath no longer resolves to a real node would, on
  // the next Save, create a duplicate file instead of overwriting. Per-mutation
  // remaps run before this, so validly-relinked tabs keep their path; clear only
  // genuinely-orphaned links so the next save prompts/creates rather than duplicates.
  const loaded = get(collections);
  tabs.update((list) => list.map((t) => (t.savedPath && !findNode(loaded, t.savedPath) ? { ...t, savedPath: undefined } : t)));
}

/**
 * Run a workspace mutation, logging (but swallowing) any failure as
 * `workspace: <name> failed`. Preserves the wrapped fn's return value on
 * success and yields `undefined` on error, so callers that return a value
 * (e.g. a new node id) keep working unchanged.
 */
async function runWorkspaceOp<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(`workspace: ${name} failed`, err);
    return undefined;
  }
}

function normalizeTabTitleState(tab: Tab): Tab {
  if (tab.manualTitle !== undefined) return tab;
  if (tab.savedPath) return { ...tab, manualTitle: true };
  const derived =
    tab.protocol === 'grpc'
      ? titleFromUrl(tab.grpc?.endpoint ?? '', GRPC_DEFAULT_TITLE)
      : titleFromUrl(tab.request.url, HTTP_DEFAULT_TITLE);
  const manualTitle = Boolean(tab.title && tab.title !== derived && !LEGACY_DEFAULT_TITLES.has(tab.title));
  return { ...tab, title: manualTitle ? tab.title : derived, manualTitle };
}

export async function openWorkspaceFolder(): Promise<void> {
  await runWorkspaceOp('openWorkspaceFolder', async () => {
    const path = await workspacePickFolder();
    if (!path) return;
    await switchWorkspace(path);
  });
}

export async function switchWorkspace(path: string): Promise<void> {
  const clean = path.trim();
  if (!clean) return;
  const switched = await runWorkspaceOp('switchWorkspace', async () => {
    const previous = get(workspacePath);
    const tree = await workspaceLoad(clean);
    workspacePath.set(clean);
    collections.set(tree);
    rememberWorkspacePath(clean);
    if (previous && previous !== clean) {
      // savedPath is relative to the old workspace root. Keeping it after a root
      // switch risks overwriting a same-named request in the new workspace.
      tabs.update((list) => list.map((t) => (t.savedPath ? { ...t, savedPath: undefined } : t)));
    }
    return true;
  });
  if (!switched) {
    recentWorkspacePaths.update((paths) => paths.filter((p) => p !== clean));
  }
}

// ---------- Tree mutations ----------

export async function addFolder(parentFolderId?: string, name = 'New Folder'): Promise<string | undefined> {
  let root = get(workspacePath);
  if (!root) {
    // No workspace open yet — prompt the user to pick one, then create in it.
    await openWorkspaceFolder();
    root = get(workspacePath);
    if (!root) return undefined; // user cancelled the picker
  }
  return runWorkspaceOp('addFolder', async () => {
    const newId = await workspaceCreateFolder(root, parentFolderId ? idToRel(parentFolderId) : ROOT, name);
    await reloadWorkspace();
    return newId;
  });
}

export async function removeNode(id: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('removeNode', async () => {
    await workspaceDelete(root, id);
    tabs.update((list) =>
      list.map((t) =>
        t.savedPath && (t.savedPath === id || t.savedPath.startsWith(id + '/'))
          ? { ...t, savedPath: undefined }
          : t,
      ),
    );
    await reloadWorkspace();
  });
}

export async function renameNode(id: string, name: string): Promise<void> {
  const root = get(workspacePath);
  const clean = name.trim();
  if (!root || !clean) return;
  await runWorkspaceOp('renameNode', async () => {
    const newId = await workspaceRename(root, id, clean);
    tabs.update((list) =>
      list.map((t) => {
        if (!t.savedPath) return t;
        if (t.savedPath === id) return { ...t, savedPath: newId, title: clean, manualTitle: true };
        if (t.savedPath.startsWith(id + '/')) return { ...t, savedPath: newId + t.savedPath.slice(id.length) };
        return t;
      }),
    );
    await reloadWorkspace();
  });
}

export function toggleFolder(id: string): void {
  collections.update((tree) => toggleIn(tree, id));
}
function toggleIn(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== 'folder') return n;
    if (n.id === id) return { ...n, expanded: !n.expanded };
    return { ...n, children: toggleIn(n.children, id) };
  });
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
 * Strip runtime-only fields from a gRPC snapshot for persistence/rehydration.
 * `connectionId` (a live backend connection) and `tree` (reflected schema) are
 * session state: the backend `conns` map is empty after an app restart, so a
 * persisted `connectionId` would make `ensureConnected` early-return against a
 * dead connection and never reconnect. endpoint/plaintext/method/message/
 * metadata are the real request and are kept.
 */
export function grpcSnapshot(grpc: GrpcTabState | undefined): GrpcTabState | undefined {
  if (!grpc) return undefined;
  const { connectionId: _connectionId, tree: _tree, ...rest } = grpc;
  return { ...rest, metadata: { ...rest.metadata } };
}

/** A tab with its live gRPC connection (connectionId/tree) stripped — for persistence. */
function stripLiveGrpc(tab: Tab): Tab {
  return tab.grpc ? { ...tab, grpc: grpcSnapshot(tab.grpc)! } : tab;
}

function stripRuntimeTab(tab: Tab): Tab {
  if (tab.protocol === 'git') return tab;
  return stripLiveGrpc(tab);
}

/** Save the active tab into folder `folderId` (root if undefined). */
export async function saveActiveRequest(folderId?: string, name?: string): Promise<void> {
  let root = get(workspacePath);
  if (!root) {
    // No workspace open — prompt the user to pick one before saving.
    await openWorkspaceFolder();
    root = get(workspacePath);
    if (!root) return; // user cancelled the picker
  }
  const tab = get(tabs).find((t) => t.id === get(activeTabId));
  if (!tab) return;
  if (tab.protocol === 'git') return;
  const finalName =
    name?.trim() ||
    (tab.protocol === 'grpc'
      ? titleFromUrl(tab.grpc?.endpoint ?? '', GRPC_DEFAULT_TITLE)
      : titleFromUrl(tab.request.url, HTTP_DEFAULT_TITLE));
  const node: RequestNode = {
    kind: 'request',
    id: tab.savedPath ?? '',
    name: finalName,
    protocol: tab.protocol,
    request: { ...tab.request, headers: { ...tab.request.headers } },
    params: tab.params ? tab.params.map((p) => ({ ...p })) : undefined,
    grpc: grpcPathsToRel(grpcSnapshot(tab.grpc), root),
  };
  const dirRel = folderId ? idToRel(folderId) : ROOT;
  try {
    const newId = await workspaceSaveRequest(root, dirRel, tab.savedPath ?? null, node);
    tabs.update((list) =>
      list.map((t) =>
        t.id === tab.id ? { ...t, title: finalName, manualTitle: true, savedPath: newId } : t,
      ),
    );
    await reloadWorkspace();
  } catch (err) {
    console.error('workspace: saveActiveRequest failed', err);
    throw err;
  }
}

/** Create a new empty request of `protocol` inside `folderId` (root if undefined) and open it. */
export async function addRequestToFolder(folderId: string | undefined, protocol: 'http' | 'grpc'): Promise<void> {
  let root = get(workspacePath);
  if (!root) { await openWorkspaceFolder(); root = get(workspacePath); if (!root) return; }
  const node: RequestNode =
    protocol === 'grpc'
      ? { kind: 'request', id: '', name: 'New gRPC', protocol: 'grpc', request: { method: 'GRPC', url: '', headers: {} }, grpc: { endpoint: '', plaintext: true, message: '{}', metadata: {} } }
      : { kind: 'request', id: '', name: 'New Request', protocol: 'http', request: { method: 'GET', url: '', headers: {} } };
  await runWorkspaceOp('addRequestToFolder', async () => {
    const newId = await workspaceSaveRequest(root, folderId ? idToRel(folderId) : ROOT, null, node);
    await reloadWorkspace();
    const created = findNode(get(collections), newId);
    if (created && created.kind === 'request') openSavedRequest(created);
  });
}

export async function duplicateNode(id: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('duplicateNode', async () => {
    await workspaceDuplicate(root, id);
    await reloadWorkspace();
  });
}

export async function moveNode(id: string, destFolderId?: string): Promise<void> {
  const root = get(workspacePath);
  if (!root) return;
  await runWorkspaceOp('moveNode', async () => {
    const newId = await workspaceMove(root, id, destFolderId ? idToRel(destFolderId) : ROOT);
    tabs.update((list) =>
      list.map((t) => {
        if (!t.savedPath) return t;
        if (t.savedPath === id) return { ...t, savedPath: newId };
        if (t.savedPath.startsWith(id + '/')) return { ...t, savedPath: newId + t.savedPath.slice(id.length) };
        return t;
      }),
    );
    await reloadWorkspace();
  });
}

export function openSavedRequest(req: RequestNode): void {
  const existing = get(tabs).find((t) => t.savedPath === req.id);
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: req.protocol,
    title: req.name,
    manualTitle: true,
    request: { ...req.request, headers: { ...req.request.headers } },
    params: req.params ? req.params.map((p) => ({ ...p })) : undefined,
    // Drop any runtime-only fields that legacy *.bonk.json files may still carry,
    // so a stale connectionId can't block reconnect after an app restart.
    grpc: grpcPathsToAbs(grpcSnapshot(req.grpc), get(workspacePath)),
    savedPath: req.id,
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function openGitDiffTab(path: string, mode: GitDiffMode = 'working'): void {
  const clean = path.trim();
  if (!clean) return;
  const existing = get(tabs).find((t) => t.protocol === 'git' && t.git?.path === clean && t.git.mode === mode);
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'git',
    title: mode === 'staged' ? `${basename(clean)} (staged)` : basename(clean),
    manualTitle: true,
    request: { method: 'DIFF', url: clean, headers: {} },
    git: { path: clean, mode },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

/** Open (or focus) the single aggregate Project Diff tab. */
export function openProjectDiffTab(): void {
  const existing = get(tabs).find((t) => t.protocol === 'git' && t.git?.view === 'project');
  if (existing) {
    activeTabId.set(existing.id);
    return;
  }
  const tab: Tab = {
    id: crypto.randomUUID(),
    protocol: 'git',
    title: 'Changes',
    manualTitle: true,
    request: { method: 'DIFF', url: '', headers: {} },
    git: { path: '', mode: 'working', view: 'project' },
  };
  tabs.update((list) => [...list, tab]);
  activeTabId.set(tab.id);
}

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

export function newTab(protocol: 'http' | 'grpc' = 'http'): void {
  const t = protocol === 'grpc' ? newGrpcTab() : newHttpTab();
  tabs.update((list) => [...list, t]);
  activeTabId.set(t.id);
}

/**
 * Parse a curl command and apply it to the active HTTP tab in place
 * (Postman-style: paste curl into the URL bar). Splits the query string into
 * the Params table. Returns false if the text isn't a usable curl command.
 */
export function applyCurlToActiveTab(curl: string): boolean {
  try {
    const request = parseCurl(curl);
    updateActiveTab((t) => ({
      ...t,
      request,
      params: paramsFromUrl(request.url),
      title: t.manualTitle ? t.title : titleFromUrl(request.url, HTTP_DEFAULT_TITLE),
    }));
    return true;
  } catch {
    return false;
  }
}

export function titleFromUrl(url: string, fallback = HTTP_DEFAULT_TITLE): string {
  const clean = url.trim();
  if (!clean) return fallback;
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(clean) ? clean : `https://${clean}`;
    const parsed = new URL(withScheme);
    return parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || fallback;
  } catch {
    const pathTitle = clean.split(/[?#]/)[0].split('/').filter(Boolean).pop();
    return pathTitle && !pathTitle.includes('}}') ? pathTitle : clean;
  }
}

export function updateActiveTab(fn: (tab: Tab) => Tab): void {
  const id = get(activeTabId);
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

/** Update a specific tab by id, regardless of which tab is currently active. */
export function updateTabById(id: string, fn: (tab: Tab) => Tab): void {
  tabs.update((list) => list.map((t) => (t.id === id ? fn(t) : t)));
}

/**
 * Send an HTTP request and write the result back to the tab it was started from,
 * captured via `tabId` — NOT whichever tab happens to be active when the response
 * resolves. This is what keeps a slow request in Tab A from landing its response
 * on Tab B after the user switches.
 *
 * On success the response is stored on the originating tab and the call is logged
 * to history. On failure the error is rethrown so the caller can decide how to
 * surface it (e.g. an error "response" scoped to that tab) — we don't write a
 * response here so the caller controls cancelled-vs-failed rendering.
 */
export async function sendHttpRequest(
  tabId: string,
  req: HttpRequest,
  requestId: string,
): Promise<void> {
  const res = await httpSend(req, requestId, currentRequestSettings());
  updateTabById(tabId, (t) => ({ ...t, response: res }));
  addHistory({ id: crypto.randomUUID(), protocol: 'http', request: req, status: res.status, at: Date.now() });
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
