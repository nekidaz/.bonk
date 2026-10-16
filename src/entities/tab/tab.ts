import type { Tab, GrpcTabState } from '$shared/model';

/**
 * Pure (store-free) tab helpers. These deliberately depend only on types so the
 * store feature-modules can share them without forming an import cycle.
 */

export const HTTP_DEFAULT_TITLE = 'Untitled request';
export const GRPC_DEFAULT_TITLE = 'Untitled gRPC request';
export const LEGACY_DEFAULT_TITLES = new Set(['New Request', 'New gRPC', HTTP_DEFAULT_TITLE, GRPC_DEFAULT_TITLE]);

export function newHttpTab(): Tab {
  return {
    id: crypto.randomUUID(),
    protocol: 'http',
    title: HTTP_DEFAULT_TITLE,
    manualTitle: false,
    request: { method: 'GET', url: '', headers: {} },
  };
}

export function newGrpcTab(): Tab {
  const grpc: GrpcTabState = { endpoint: '', plaintext: true, message: '', metadata: {} };
  return {
    id: crypto.randomUUID(),
    protocol: 'grpc',
    title: GRPC_DEFAULT_TITLE,
    manualTitle: false,
    request: { method: 'GRPC', url: '', headers: {} },
    grpc,
  };
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
export function stripLiveGrpc(tab: Tab): Tab {
  return tab.grpc ? { ...tab, grpc: grpcSnapshot(tab.grpc)! } : tab;
}

export function stripRuntimeTab(tab: Tab): Tab {
  if (tab.protocol !== 'http' && tab.protocol !== 'grpc') return tab;
  // `testResults` is ephemeral script output, not part of the saved request;
  // drop it so it doesn't bloat persisted state (matches how live gRPC fields
  // are stripped below).
  const { testResults: _testResults, grpcStream: _grpcStream, sent: _sent, ...rest } = tab;
  return stripLiveGrpc(rest);
}

export function normalizeTabTitleState(tab: Tab): Tab {
  if (tab.manualTitle !== undefined) return tab;
  if (tab.savedPath) return { ...tab, manualTitle: true };
  const derived =
    tab.protocol === 'grpc'
      ? titleFromUrl(tab.grpc?.endpoint ?? '', GRPC_DEFAULT_TITLE)
      : titleFromUrl(tab.request.url, HTTP_DEFAULT_TITLE);
  const manualTitle = Boolean(tab.title && tab.title !== derived && !LEGACY_DEFAULT_TITLES.has(tab.title));
  return { ...tab, title: manualTitle ? tab.title : derived, manualTitle };
}

/**
 * Remap (or clear) the `savedPath` of every tab after a workspace node moved,
 * was renamed, or was deleted — deduplicating the relink logic shared by
 * renameNode / moveNode / removeNode.
 *
 * `toId === undefined` clears savedPath on the matching tab(s) (the delete case:
 * an orphaned savedPath would, on the next Save, create a duplicate file instead
 * of overwriting). Otherwise the exact match remaps to `toId`, and any nested tab
 * whose savedPath starts with `fromId + '/'` is re-prefixed to keep pointing at
 * the same file under its new parent id.
 */
export function relinkTabPaths(list: Tab[], fromId: string, toId: string | undefined): Tab[] {
  return list.map((t) => {
    if (!t.savedPath) return t;
    if (t.savedPath === fromId) {
      return toId === undefined ? { ...t, savedPath: undefined } : { ...t, savedPath: toId };
    }
    if (t.savedPath.startsWith(fromId + '/')) {
      return toId === undefined
        ? { ...t, savedPath: undefined }
        : { ...t, savedPath: toId + t.savedPath.slice(fromId.length) };
    }
    return t;
  });
}

/** Move the tab `id` to position `to` (drag-reorder in the tab strip). Unknown id or same slot → same list. */
export function moveTabTo(list: Tab[], id: string, to: number): Tab[] {
  const from = list.findIndex((t) => t.id === id);
  if (from < 0 || from === to) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** S17b: flip `id`'s pin; pinned tabs lead the strip, each group keeping its order. */
export function togglePinned(list: Tab[], id: string): Tab[] {
  const next = list.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
  return [...next.filter((t) => t.pinned), ...next.filter((t) => !t.pinned)];
}

/** S17b: ids that “Close Others / Close Tabs to the Right / Close All” close relative to `id`. Pinned tabs always stay. */
export function tabsToClose(list: Tab[], id: string, scope: 'others' | 'right' | 'all'): string[] {
  const at = list.findIndex((t) => t.id === id);
  if (at < 0 && scope !== 'all') return [];
  return list
    .filter((t, i) => !t.pinned && (scope === 'all' || (scope === 'others' ? i !== at : i > at)))
    .map((t) => t.id);
}

/** P3/P4: switching HTTP ⇄ gRPC starts an empty, unsaved request of the new type in the same tab (pin kept); undo restores the old tab. */
export function switchedProtocol(tab: Tab, protocol: 'http' | 'grpc'): Tab {
  const fresh = protocol === 'grpc' ? newGrpcTab() : newHttpTab();
  return { ...fresh, id: tab.id, pinned: tab.pinned };
}
