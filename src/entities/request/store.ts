import {
  openInNewTab,
  proxyAuth,
  proxyUser,
  proxyPassword,
  trustSystemCas,
  activeClientCerts,
  requestPrefs,
  cookiesSave,
  cookiesSend,
  cookiesKeepSession,
  cookiesExclude,
  dynamicOptions,
  dynKeepSent,
} from '$shared/settings';
import { dirtyTabIds } from './dirtyTabs.svelte';
import {
  type Tab,
  type RequestNode,
  type HttpRequest,
  type RequestSettings,
  type HttpResponse,
  parseCurl,
  paramsFromUrl,
  mergeScope,
  applyEnvPatch,
  applyRequestPatch,
  buildScriptContext,
  collectScriptRun,
  scriptFailure,
  type ScriptResult,
  type DynamicValue,
} from '$shared/model';
import { withOverrides } from './requestSettings';
import { httpResolve, httpSend, workspaceSaveRequest, runScript } from '$shared/ipc';
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
import { grpcPathsToRel, grpcPathsToAbs } from './protoPaths';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl, tabs } from '$entities/tab';
import { environments, currentVarScope, setEnvVars, setGlobalVars } from '$entities/environment';
import { addHistory } from '$entities/history';
import { addAppConsoleEntry } from './console.svelte';
import { oauthCardKey, oauthRuntime, withOAuthToken } from './oauth.svelte';
import { cookieJar, cookieJarKey } from '$entities/cookies';

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function currentRequestSettings(): RequestSettings {
  const timeoutMs = clampInt(requestPrefs.requestTimeoutMs, 0, 600_000, 30_000);
  const maxResponseBodyMb = clampInt(requestPrefs.responseBodyLimitMb, 1, 250, 25);
  const auth = requestPrefs.proxyMode === 'manual' && proxyAuth.current;
  return {
    timeoutMs,
    followRedirects: requestPrefs.requestFollowRedirects,
    validateTls: requestPrefs.requestValidateTls,
    maxResponseBodyBytes: maxResponseBodyMb * 1024 * 1024,
    proxy: {
      mode: requestPrefs.proxyMode,
      url: requestPrefs.proxyUrl.trim(),
      bypass: requestPrefs.proxyBypass.trim(),
      username: auth ? proxyUser.current.trim() : '',
      password: auth ? proxyPassword.current : '',
    },
    caPaths: requestPrefs.trustedCaPaths,
    trustSystemCas: trustSystemCas.current,
    clientCerts: activeClientCerts(),
    cookieJar: cookieJarKey(),
    cookiesSave: cookiesSave.current,
    cookiesSend: cookiesSend.current,
    cookiesKeepSession: cookiesKeepSession.current,
    cookiesExclude: cookiesExclude.current,
  };
}

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
    request: { ...tab.request, headers: { ...tab.request.headers } },
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
    request: { ...req.request, headers: { ...req.request.headers } },
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

/** The active environment's `name → value` map, or `{}` when none is selected. */
function activeEnvMap(): Record<string, string> {
  const id = environments.activeId;
  const env = id ? environments.list.find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
function globalsMap(): Record<string, string> {
  return mergeScope(environments.globals, undefined);
}

/**
 * Fold a ScriptResult's env/globals mutations back into the stores. Writes to
 * the ACTIVE environment (if any) via setEnvVars and to globals via
 * setGlobalVars, mirroring Postman's `pm.environment.set` / `pm.globals.set`.
 * Exported so the Collection Runner folds script writes the exact same way,
 * which is what lets a later request in the run see an earlier one's writes.
 */
export function applyScriptVars(
  result: Pick<ScriptResult, 'envSet' | 'envUnset' | 'globalsSet' | 'globalsUnset' | 'cookieClears'>,
): void {
  const hasEnv = Object.keys(result.envSet).length > 0 || result.envUnset.length > 0;
  const hasGlob = Object.keys(result.globalsSet).length > 0 || result.globalsUnset.length > 0;
  if (hasEnv) {
    const id = environments.activeId;
    if (id) {
      const env = environments.list.find((e) => e.id === id);
      if (env) setEnvVars(id, applyEnvPatch(env.vars, result.envSet, result.envUnset));
    }
  }
  if (hasGlob) {
    setGlobalVars(applyEnvPatch(environments.globals, result.globalsSet, result.globalsUnset));
  }
  for (const url of result.cookieClears ?? []) void cookieJar.clearFor(url);
}

/** Run one stage's script; an IPC failure (timeout, bad output) becomes a failed result, never a throw. */
async function runStage(phase: 'pre-request' | 'test', code: string, context: unknown): Promise<ScriptResult> {
  try {
    return await runScript(phase, code, context);
  } catch (error) {
    return scriptFailure(String(error));
  }
}

const hasScript = (code: string | undefined): code is string => !!code && code.trim() !== '';

/**
 * Send an HTTP request and write the result back to the tab it was started from,
 * captured via `tabId` — NOT whichever tab happens to be active when the response
 * resolves. This is what keeps a slow request in Tab A from landing its response
 * on Tab B after the user switches.
 *
 * Script flow (Postman-style; gRPC runs the same flow, see GrpcEditor.svelte
 * and execute.ts's runGrpcNode):
 *   1. pre-request script (if any) runs FIRST, against the raw request; it can
 *      patch the outgoing request and set env/globals — those writes then feed
 *      the {{var}} resolution below.
 *   2. {{var}} placeholders are resolved.
 *   3. the request is sent.
 *   4. the post-response script (if any) runs against the response; its env/globals
 *      writes are applied and its tests/console rows attach to the tab.
 *
 * `skipScripts` sends the request as-is («Отправить без скриптов», SC6).
 *
 * On success the response is stored on the originating tab and the call is logged
 * to history. On failure the error is rethrown so the caller can decide how to
 * surface it (e.g. an error "response" scoped to that tab) — we don't write a
 * response here so the caller controls cancelled-vs-failed rendering. A fatal
 * pre-request script error is likewise thrown before any send happens; the tab's
 * `testResults.errorPhase === 'pre'` tells the response pane it was never sent.
 */
export async function sendHttpRequest(
  tabId: string,
  req: HttpRequest,
  requestId: string,
  opts: { skipScripts?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now();
  if (opts.skipScripts) req = { ...req, preRequestScript: undefined, testScript: undefined };
  let outgoing = req;
  let pre: ScriptResult | undefined;
  let post: ScriptResult | undefined;
  const logs = () => [...(pre?.logs ?? []), ...(post?.logs ?? [])];
  const keepResults = () =>
    tabs.updateById(tabId, (t) => ({ ...t, testResults: collectScriptRun({ pre, post, at: Date.now() }) }));

  // 1. Pre-request script — runs before {{var}} resolution, against the raw
  //    request. Applies its request patch + env/globals writes; a fatal error
  //    aborts the send.
  if (hasScript(req.preRequestScript)) {
    pre = await runStage(
      'pre-request',
      req.preRequestScript,
      buildScriptContext(
        req,
        undefined,
        activeEnvMap(),
        globalsMap(),
        {},
        cookieJar.scriptCookies((await httpResolve(req, currentVarScope())).request.url),
      ),
    );
    applyScriptVars(pre);
    if (pre.error) {
      keepResults();
      addAppConsoleEntry({
        protocol: 'http',
        method: outgoing.method || 'HTTP',
        url: outgoing.url,
        ok: false,
        status: 'SCRIPT ERROR',
        elapsedMs: Date.now() - startedAt,
        message: pre.error,
        logs: logs(),
      });
      throw new Error(pre.error);
    }
    outgoing = applyRequestPatch(outgoing, pre.requestPatch);
  }

  // 2. OAuth: the keychain token goes into the outgoing copy (refreshed or re-fetched
  //    when it expired). Then {{var}} placeholders (globals + active environment, now
  //    including anything the pre-request script set) are resolved just before sending.
  const settings = withOverrides(currentRequestSettings(), tabs.list.find((t) => t.id === tabId)?.settings);
  const scope = currentVarScope();
  const oauthKey = outgoing.auth?.type === 'oauth2' ? oauthCardKey(outgoing.auth, environments.activeId) : '';
  const dynamic = dynamicOptions();
  let dynamicValues: DynamicValue[] = [];
  const withToken = async (force: boolean): Promise<HttpRequest> => {
    const { auth, ensured } = await withOAuthToken(outgoing.auth, scope, settings, force);
    if (ensured?.renewed) {
      oauthRuntime.setRenewal(tabId, {
        key: oauthKey,
        at: Date.now(),
        previousExpiresAt: ensured.previousExpiresAt,
        byRefresh: ensured.token.hasRefresh && ensured.previousExpiresAt !== null,
        tokenUrl: outgoing.auth?.oauth?.tokenUrl ?? '',
      });
    } else if (ensured && !force) oauthRuntime.setRenewal(tabId, undefined);
    const out = await httpResolve({ ...outgoing, auth }, scope, dynamic);
    dynamicValues = out.dynamic;
    return out.request;
  };
  let resolved: HttpRequest;
  try {
    resolved = await withToken(false);
  } catch (error) {
    keepResults();
    addAppConsoleEntry({
      protocol: 'http',
      method: outgoing.method || 'HTTP',
      url: outgoing.url,
      ok: false,
      status: 'ERROR',
      elapsedMs: Date.now() - startedAt,
      message: String(error instanceof Error ? error.message : error),
      logs: logs(),
    });
    throw error;
  }

  // 3. Send. History records the resolved request so replay/inspection shows the
  //    values actually sent, not the templates. A 401 with an OAuth token renews it
  //    once and resends (the server may have revoked it early).
  const sentAt = Date.now();
  let res: HttpResponse;
  try {
    res = await httpSend(resolved, requestId, settings);
    if (res.status === 401 && oauthKey) {
      const retry = await withToken(true).catch(() => undefined);
      if (retry) {
        resolved = retry;
        res = await httpSend(resolved, requestId, settings);
      }
    }
  } catch (error) {
    keepResults();
    addAppConsoleEntry({
      protocol: 'http',
      method: resolved.method || 'HTTP',
      url: resolved.url,
      ok: false,
      status: 'ERROR',
      elapsedMs: Date.now() - startedAt,
      message: String(error),
      logs: logs(),
    });
    throw error;
  }

  // 4. Post-response script — runs against the response. Its env/globals writes
  //    are applied; its tests/console rows (plus the pre-request ones) attach to the tab.
  let postMs: number | undefined;
  if (hasScript(req.testScript)) {
    const t0 = performance.now();
    const cookies = cookieJar.scriptCookies(resolved.url, res.cookies);
    post = await runStage(
      'test',
      req.testScript,
      buildScriptContext(resolved, res, activeEnvMap(), globalsMap(), {}, cookies),
    );
    postMs = Math.round(performance.now() - t0);
    applyScriptVars(post);
  }
  const testError = post?.error ?? undefined;
  const send = {
    t: sentAt,
    text: `${resolved.method} ${resolved.url}`,
    status: String(res.status),
    ms: res.elapsed_ms,
  };
  const testResults = collectScriptRun({ pre, post, send, postMs, at: Date.now() });
  const renewal = oauthKey ? oauthRuntime.renewals[tabId] : undefined;
  if (renewal && !renewal.sent) {
    oauthRuntime.setRenewal(tabId, { ...renewal, sent: { text: send.text, status: res.status, ms: res.elapsed_ms } });
  }
  const sent = dynKeepSent.current ? { request: resolved, dynamic: dynamicValues } : undefined;
  tabs.updateById(tabId, (t) => ({ ...t, response: res, testResults, sent }));
  addAppConsoleEntry({
    protocol: 'http',
    method: resolved.method || 'HTTP',
    url: resolved.url,
    ok: res.status >= 200 && res.status < 400 && !testError,
    status: String(res.status),
    elapsedMs: res.elapsed_ms,
    message: testError,
    logs: logs(),
  });
  const src = tabs.list.find((t) => t.id === tabId);
  addHistory({
    id: crypto.randomUUID(),
    protocol: 'http',
    request: resolved,
    status: res.status,
    at: Date.now(),
    savedPath: src?.savedPath,
    title: src?.title,
    raw: src?.request,
    params: src?.params,
  });
}
