import { get } from 'svelte/store';
import type { Tab, RequestNode, HttpRequest, RequestSettings, HttpResponse } from '../domain/types';
import { httpSend, workspaceSaveRequest, runScript } from '../api';
import { idToRel, findNode } from '../domain/tree';
import { grpcPathsToRel, grpcPathsToAbs } from '../domain/protoPaths';
import { parseCurl } from '../domain/curl';
import { paramsFromUrl } from '../domain/http';
import { resolveRequestVars, mergeScope } from '../domain/vars';
import {
  applyEnvPatch,
  applyRequestPatch,
  buildScriptContext,
  type ScriptResult,
} from '../domain/scripts';
import { GRPC_DEFAULT_TITLE, HTTP_DEFAULT_TITLE, grpcSnapshot, titleFromUrl } from '../domain/tab';
import {
  tabs,
  activeTabId,
  workspacePath,
  collections,
  requestTimeoutMs,
  requestFollowRedirects,
  requestValidateTls,
  responseBodyLimitMb,
  globals,
  environments,
  activeEnvironmentId,
  ROOT,
  updateActiveTab,
  updateTabById,
  currentVarScope,
} from './state';
import { setEnvVars, setGlobalVars } from './environments';
import { openWorkspaceFolder, reloadWorkspace, runWorkspaceOp } from './workspace';
import { addHistory } from './history';

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
  if (tab.protocol === 'git' || tab.protocol === 'env' || tab.protocol === 'runner') return;
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

/** The active environment's `name → value` map, or `{}` when none is selected. */
function activeEnvMap(): Record<string, string> {
  const id = get(activeEnvironmentId);
  const env = id ? get(environments).find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
function globalsMap(): Record<string, string> {
  return mergeScope(get(globals), undefined);
}

/**
 * Fold a ScriptResult's env/globals mutations back into the stores. Writes to
 * the ACTIVE environment (if any) via setEnvVars and to globals via
 * setGlobalVars, mirroring Postman's `pm.environment.set` / `pm.globals.set`.
 * Exported so the Collection Runner folds script writes the exact same way,
 * which is what lets a later request in the run see an earlier one's writes.
 */
export function applyScriptVars(result: ScriptResult): void {
  const hasEnv = Object.keys(result.envSet).length > 0 || result.envUnset.length > 0;
  const hasGlob = Object.keys(result.globalsSet).length > 0 || result.globalsUnset.length > 0;
  if (hasEnv) {
    const id = get(activeEnvironmentId);
    if (id) {
      const env = get(environments).find((e) => e.id === id);
      if (env) setEnvVars(id, applyEnvPatch(env.vars, result.envSet, result.envUnset));
    }
  }
  if (hasGlob) {
    setGlobalVars(applyEnvPatch(get(globals), result.globalsSet, result.globalsUnset));
  }
}

/**
 * Send an HTTP request and write the result back to the tab it was started from,
 * captured via `tabId` — NOT whichever tab happens to be active when the response
 * resolves. This is what keeps a slow request in Tab A from landing its response
 * on Tab B after the user switches.
 *
 * Script flow (Postman-style), HTTP-only for this MVP (gRPC has no scripts):
 *   1. pre-request script (if any) runs FIRST, against the raw request; it can
 *      patch the outgoing request and set env/globals — those writes then feed
 *      the {{var}} resolution below.
 *   2. {{var}} placeholders are resolved.
 *   3. the request is sent.
 *   4. the test script (if any) runs against the response; its env/globals
 *      writes are applied and its tests/logs attach to the tab.
 *
 * On success the response is stored on the originating tab and the call is logged
 * to history. On failure the error is rethrown so the caller can decide how to
 * surface it (e.g. an error "response" scoped to that tab) — we don't write a
 * response here so the caller controls cancelled-vs-failed rendering. A fatal
 * pre-request script error is likewise thrown before any send happens.
 */
export async function sendHttpRequest(
  tabId: string,
  req: HttpRequest,
  requestId: string,
): Promise<void> {
  let outgoing = req;
  const tests: ScriptResult['tests'] = [];
  const logs: string[] = [];

  // 1. Pre-request script — runs before {{var}} resolution, against the raw
  //    request. Applies its request patch + env/globals writes; a fatal error
  //    aborts the send.
  if (req.preRequestScript && req.preRequestScript.trim() !== '') {
    const context = buildScriptContext(req, undefined, activeEnvMap(), globalsMap());
    const pre = await runScript('pre-request', req.preRequestScript, context);
    applyScriptVars(pre);
    logs.push(...pre.logs);
    tests.push(...pre.tests);
    if (pre.error) {
      updateTabById(tabId, (t) => ({ ...t, testResults: { tests, logs, error: pre.error ?? undefined } }));
      throw new Error(pre.error);
    }
    outgoing = applyRequestPatch(outgoing, pre.requestPatch);
  }

  // 2. Interpolate {{var}} placeholders (globals + active environment, now
  //    including anything the pre-request script set) just before sending.
  const resolved = resolveRequestVars(outgoing, currentVarScope());

  // 3. Send. History records the resolved request so replay/inspection shows the
  //    values actually sent, not the templates.
  const res: HttpResponse = await httpSend(resolved, requestId, currentRequestSettings());

  // 4. Test script — runs against the response. Its env/globals writes are
  //    applied; its tests/logs (plus any pre-request ones) attach to the tab.
  let testError: string | undefined;
  if (req.testScript && req.testScript.trim() !== '') {
    const context = buildScriptContext(resolved, res, activeEnvMap(), globalsMap());
    const post = await runScript('test', req.testScript, context);
    applyScriptVars(post);
    logs.push(...post.logs);
    tests.push(...post.tests);
    testError = post.error ?? undefined;
  }

  const testResults =
    tests.length > 0 || logs.length > 0 || testError
      ? { tests, logs, error: testError }
      : undefined;
  updateTabById(tabId, (t) => ({ ...t, response: res, testResults }));
  addHistory({ id: crypto.randomUUID(), protocol: 'http', request: resolved, status: res.status, at: Date.now() });
}
