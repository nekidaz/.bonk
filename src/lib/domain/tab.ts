import type { Tab, GrpcTabState } from './types';

/**
 * Pure (store-free) tab helpers. These deliberately depend only on types so the
 * store feature-modules can share them without forming an import cycle.
 */

export const HTTP_DEFAULT_TITLE = 'Untitled Request';
export const GRPC_DEFAULT_TITLE = 'New gRPC';
export const LEGACY_DEFAULT_TITLES = new Set(['New Request', HTTP_DEFAULT_TITLE, GRPC_DEFAULT_TITLE]);

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
  if (tab.protocol === 'git') return tab;
  // `testResults` is ephemeral script output, not part of the saved request;
  // drop it so it doesn't bloat persisted state (matches how live gRPC fields
  // are stripped below).
  const { testResults: _testResults, ...rest } = tab;
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
