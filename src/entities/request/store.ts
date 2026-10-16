import { openInNewTab, dynKeepSent } from '$shared/settings';
import { dirtyTabIds } from './dirtyTabs.svelte';
import {
  type Tab,
  type RequestNode,
  type HttpRequest,
  parseCurl,
  paramsFromUrl,
  collectScriptRun,
  parseScriptResult,
} from '$shared/model';
import { withOverrides } from './requestSettings';
import { workspaceSaveRequest } from '$shared/ipc';
import {
  idToRel,
  findNode,
  parentId,
  ROOT,
  openWorkspaceFolder,
  refreshDirs,
  runWorkspaceOp,
  workspace,
} from '$entities/workspace';
import { grpcPathsToRel, grpcPathsToAbs, httpPathsToRel, httpPathsToAbs } from './protoPaths';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl, tabs } from '$entities/tab';
import { environments } from '$entities/environment';
import { addHistory } from '$entities/history';
import { addAppConsoleEntry } from './console.svelte';
import { currentRequestSettings, applyScriptVars } from './executionState';
export { currentRequestSettings, applyScriptVars } from './executionState';
import { executeRequest } from './execute';
import { oauthCardKey, oauthRuntime } from './oauth.svelte';
import { sessionRuntime } from './session.svelte';

/** Save the active tab into folder `folderId` (root if undefined). `asCopy` («Сохранить как…») writes a new file and points the tab at it, leaving the original untouched. */
export async function saveActiveRequest(folderId?: string, name?: string, asCopy = false): Promise<void> {
  let root = workspace.path;
  if (!root) {
    // No workspace open — prompt the user to pick one before saving.
    await openWorkspaceFolder();
    root = workspace.path;
    if (!root) return; // user cancelled the picker
  }
  const tab = tabs.active;
  if (!tab) return;
  if (tab.protocol !== 'http' && tab.protocol !== 'grpc') return;
  const finalName =
    name?.trim() ||
    (tab.protocol === 'grpc'
      ? titleFromUrl(tab.grpc?.endpoint ?? '', GRPC_DEFAULT_TITLE)
      : titleFromUrl(tab.request.url, HTTP_DEFAULT_TITLE));
  const node: RequestNode = {
    kind: 'request',
    id: asCopy ? '' : (tab.savedPath ?? ''),
    name: finalName,
    protocol: tab.protocol,
    request: httpPathsToRel(tab.request, root),
    params: tab.params ? tab.params.map((p) => ({ ...p })) : undefined,
    grpc: grpcPathsToRel(grpcSnapshot(tab.grpc), root),
  };
  const dirRel = folderId ? idToRel(folderId) : ROOT;
  try {
    const existing = asCopy ? undefined : tab.savedPath;
    const newId = await workspaceSaveRequest(root, dirRel, existing ?? null, node);
    tabs.update((list) =>
      list.map((t) => (t.id === tab.id ? { ...t, title: finalName, manualTitle: true, savedPath: newId } : t)),
    );
    // Saving into another folder moves the file, so its old folder changed too.
    await (existing ? refreshDirs(folderId, parentId(existing)) : refreshDirs(folderId));
  } catch (err) {
    console.error('workspace: saveActiveRequest failed', err);
    throw err;
  }
}

/**
 * Undo a save (S09b toast): write the previous version of a saved request back to its file and put
 * open tabs for it back to that version.
 */
export async function restoreSavedRequest(prev: RequestNode): Promise<void> {
  const root = workspace.path;
  if (!root) return;
  const folder = parentId(prev.id);
  await workspaceSaveRequest(root, folder ? idToRel(folder) : ROOT, prev.id, prev);
  tabs.update((list) =>
    list.map((t) =>
      t.savedPath === prev.id
        ? {
            ...t,
            title: prev.name,
            request: { ...prev.request, headers: { ...prev.request.headers } },
            params: prev.params?.map((p) => ({ ...p })),
          }
        : t,
    ),
  );
  await refreshDirs(folder);
}

/** Create a new empty request of `protocol` inside `folderId` (root if undefined) and open it. */
export async function addRequestToFolder(folderId: string | undefined, protocol: 'http' | 'grpc'): Promise<void> {
  let root = workspace.path;
  if (!root) {
    await openWorkspaceFolder();
    root = workspace.path;
    if (!root) return;
  }
  const node: RequestNode =
    protocol === 'grpc'
      ? {
          kind: 'request',
          id: '',
          name: 'New gRPC',
          protocol: 'grpc',
          request: { method: 'GRPC', url: '', headers: {} },
          grpc: { endpoint: '', plaintext: true, message: '', metadata: {} },
        }
      : {
          kind: 'request',
          id: '',
          name: 'New Request',
          protocol: 'http',
          request: { method: 'GET', url: '', headers: {} },
        };
  await runWorkspaceOp('addRequestToFolder', async () => {
    const newId = await workspaceSaveRequest(root, folderId ? idToRel(folderId) : ROOT, null, node);
    await refreshDirs(folderId);
    const created = findNode(workspace.tree, newId);
    if (created && created.kind === 'request') openSavedRequest(created);
  });
}

/** Focus the request's open tab, or open it; `inNewTab` (⌘-click) always opens another tab. */
export function openSavedRequest(req: RequestNode, inNewTab = false): void {
  const existing = !inNewTab && tabs.list.find((t) => t.savedPath === req.id);
  if (existing) {
    tabs.activeId = existing.id;
    return;
  }
  // Settings → «Открывать запрос в новой вкладке» off: reuse the active saved
  // request's tab when it has no unsaved changes (scratch tabs are never replaced).
  const current = tabs.active;
  const reuse =
    !inNewTab &&
    !openInNewTab.current &&
    current?.savedPath &&
    (current.protocol === 'http' || current.protocol === 'grpc') &&
    !dirtyTabIds.current.has(current.id);
  const tab: Tab = {
    id: reuse ? current.id : crypto.randomUUID(),
    protocol: req.protocol,
    title: req.name,
    manualTitle: true,
    request: httpPathsToAbs(req.request, workspace.path),
    params: req.params ? req.params.map((p) => ({ ...p })) : undefined,
    // Drop any runtime-only fields that legacy *.bonk.json files may still carry,
    // so a stale connectionId can't block reconnect after an app restart.
    grpc: grpcPathsToAbs(grpcSnapshot(req.grpc), workspace.path),
    savedPath: req.id,
  };
  tabs.update((list) => (reuse ? list.map((t) => (t.id === tab.id ? tab : t)) : [...list, tab]));
  tabs.activeId = tab.id;
}

/**
 * Parse a curl command and apply it to the active HTTP tab in place
 * (Postman-style: paste curl into the URL bar). Splits the query string into
 * the Params table. Returns false if the text isn't a usable curl command.
 */
export function applyCurlToActiveTab(curl: string): boolean {
  try {
    const request = parseCurl(curl);
    tabs.updateActive((t) => ({
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

/** Send through bonk-core; presentation and history stay tied to the originating tab. */
export async function sendHttpRequest(
  tabId: string,
  req: HttpRequest,
  requestId: string,
  opts: { skipScripts?: boolean } = {},
): Promise<void> {
  const src = tabs.list.find((t) => t.id === tabId);
  const envId = environments.activeId;
  const keepSent = dynKeepSent.current;
  const sentAt = Date.now();
  if (opts.skipScripts) req = { ...req, preRequestScript: undefined, testScript: undefined };
  const { row, details } = await executeRequest(
    {
      kind: 'request',
      id: src?.savedPath ?? '',
      name: src?.title ?? req.url,
      protocol: 'http',
      request: req,
      params: src?.params,
    },
    requestId,
    withOverrides(currentRequestSettings(), src?.settings),
    undefined,
    undefined,
    (e) => {
      if (e.kind === 'sseOpen')
        tabs.updateById(tabId, (t) => ({ ...t, sseLive: { events: [], startedAt: e.started_at_ms } }));
      // ponytail: the array is copied on every event (like the gRPC feed); at thousands of events a second,
      // buffer and flush every ~50 ms.
      else
        tabs.updateById(tabId, (t) =>
          t.sseLive ? { ...t, sseLive: { ...t.sseLive, events: [...t.sseLive.events, e] } } : t,
        );
    },
  );
  const pre = details.pre ? parseScriptResult(JSON.stringify(details.pre)) : undefined;
  const post = details.post ? parseScriptResult(JSON.stringify(details.post)) : undefined;
  const response = details.response;
  const resolved = details.request ?? req;
  const send = response
    ? {
        t: sentAt,
        text: `${resolved.method} ${resolved.url}`,
        status: String(response.status),
        ms: response.elapsed_ms,
      }
    : undefined;
  const testResults = collectScriptRun({ pre, post, send, postMs: details.postMs ?? undefined, at: Date.now() });
  tabs.updateById(tabId, (t) => ({
    ...t,
    testResults,
    sent: keepSent && details.request ? { request: details.request, dynamic: details.dynamic } : undefined,
    ...(response ? { response } : {}),
    sseLive: undefined,
  }));
  if (req.auth?.type === 'oauth2' && details.oauth) {
    const got = details.oauth;
    oauthRuntime.setRenewal(
      tabId,
      got.renewed
        ? {
            key: oauthCardKey(req.auth, envId),
            at: Date.now(),
            previousExpiresAt: got.previousExpiresAt,
            byRefresh: got.token.hasRefresh && got.previousExpiresAt !== null,
            tokenUrl: req.auth.oauth?.tokenUrl ?? '',
            sent: response ? { text: send?.text ?? '', status: response.status, ms: response.elapsed_ms } : undefined,
          }
        : undefined,
    );
  }
  // A send that renewed the session or signed in again leaves its timeline for the Authorization tab.
  const used = details.session;
  sessionRuntime.setUse(
    tabId,
    used && used.outcome !== 'valid'
      ? {
          ...used,
          at: Date.now(),
          sent: response ? { text: send?.text ?? '', status: response.status, ms: response.elapsed_ms } : undefined,
        }
      : undefined,
  );
  if (used && used.outcome !== 'valid') sessionRuntime.changed();
  addAppConsoleEntry({
    protocol: 'http',
    method: resolved.method || 'HTTP',
    url: resolved.url,
    ok: row.ok,
    status: response ? String(response.status) : pre?.error ? 'SCRIPT ERROR' : 'ERROR',
    elapsedMs: row.elapsedMs,
    message: row.error,
    logs: row.logs,
    tests: row.tests,
    scripted: !!(req.preRequestScript?.trim() || req.testScript?.trim()),
    title: src?.title,
    nodeId: src?.savedPath,
    tabId,
    request: { headers: resolved.headers ?? {}, body: resolved.body },
    response: response ? { headers: response.headers, body: response.body, sizeBytes: response.size_bytes } : undefined,
  });
  if (!response) throw new Error(row.error ?? 'no response');
  addHistory({
    id: crypto.randomUUID(),
    protocol: 'http',
    request: resolved,
    status: response.status,
    at: Date.now(),
    savedPath: src?.savedPath,
    title: src?.title,
    raw: src?.request,
    params: src?.params,
  });
}
