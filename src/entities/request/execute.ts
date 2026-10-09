import { get } from 'svelte/store';
import { t } from '$shared/i18n';
import {
  type RequestNode,
  type HttpRequest,
  type RunResultRow,
  type ScriptTestResult,
  mergeScope,
  resolveRequestVars,
  resolveVars,
  applyRequestPatch,
  buildScriptContext,
  applyGrpcRequestPatch,
  buildGrpcScriptContext,
  buildUrl,
  buildRequestForSend,
  allTestsPassed,
} from '$shared/model';
import { grpcTlsFor, currentGrpcPrefs, withGlobalImports, requestPrefs } from '$shared/settings';
import { httpSend, runScript, grpcConnect, grpcReflect, grpcCall, grpcLoadProto } from '$shared/ipc';
import { grpcPathsToAbs } from './protoPaths';
import {
  inferGrpcPlaintext,
  grpcConnectFailureMessage,
  methodShort,
  outgoingGrpcMetadata,
  stripsAuthorization,
  grpcAuthMetadata,
} from './grpc';
import { effectiveAuth, collections, workspacePath, withInheritedAuth } from '$entities/workspace';
import { activeEnvironmentId, environments, globals } from '$entities/environment';
import { currentRequestSettings, applyScriptVars } from './store';

/**
 * Collection Runner execution: runs ONE saved request (HTTP or gRPC) through the
 * interactive send + script pipeline and returns a result row instead of writing
 * to a tab. Folds script env/globals writes into the real stores via
 * `applyScriptVars`, and recomputes the env/globals maps FRESH per request so a
 * later request sees an earlier one's writes. Depends on `store.ts`,
 * `shared/ipc` and pure model code only (never on `features/runner`), keeping the graph acyclic.
 */

// ---- Run scope helpers (recomputed FRESH per request; see the fold note) ----
// Exported for entities/flow/store.ts, which shares the same script-context needs.

/** The active environment's `name → value` map, or `{}` when none is selected. */
export function activeEnvMap(): Record<string, string> {
  const id = get(activeEnvironmentId);
  const env = id ? get(environments).find((e) => e.id === id) : undefined;
  return mergeScope([], env);
}

/** The globals `name → value` map. */
export function globalsMap(): Record<string, string> {
  return mergeScope(get(globals), undefined);
}

/**
 * Build the `{{var}}` resolution scope for one request. Precedence is
 * iterationData > active env > globals, so a data-file column overrides an env
 * var of the same name (matching the `pm.variables.get` precedence in the
 * script prelude). Read fresh each call so earlier script writes are visible.
 */
function runScopeFor(iterationData: Record<string, string>): Record<string, string> {
  return { ...globalsMap(), ...activeEnvMap(), ...iterationData };
}

/** Result of the headless HTTP pipeline (returned, not written to a tab). */
interface HttpRunOutcome {
  status: number;
  elapsedMs: number;
  tests: ScriptTestResult[];
  logs: string[];
  error?: string;
  /** Response body (absent when the pre-request script aborted the send). */
  body?: string;
  size?: number;
}

/**
 * Headless HTTP pipeline, derived from `sendHttpRequest` but returning data
 * instead of writing to a tab. Folds pre-request + test script env/globals
 * writes into the real stores as it goes (via the shared `applyScriptVars`), so
 * later requests in the run observe them. `iterationData` feeds both the script
 * context (`pm.iterationData`) and the `{{var}}` scope.
 */
async function runHttp(req: HttpRequest, iterationData: Record<string, string>): Promise<HttpRunOutcome> {
  const tests: ScriptTestResult[] = [];
  const logs: string[] = [];
  let outgoing = req;

  // 1. Pre-request script — against the raw request; writes fold into the stores
  //    (feeding {{var}} resolution below) and a fatal error aborts this request.
  if (req.preRequestScript && req.preRequestScript.trim() !== '') {
    const context = buildScriptContext(req, undefined, activeEnvMap(), globalsMap(), iterationData);
    const pre = await runScript('pre-request', req.preRequestScript, context);
    applyScriptVars(pre);
    logs.push(...pre.logs);
    tests.push(...pre.tests);
    if (pre.error) return { status: 0, elapsedMs: 0, tests, logs, error: pre.error };
    outgoing = applyRequestPatch(outgoing, pre.requestPatch);
  }

  // 2. Interpolate {{var}} placeholders (fresh scope, now including pre-request
  //    writes), then send.
  const resolved = resolveRequestVars(outgoing, runScopeFor(iterationData));
  const requestId = crypto.randomUUID();
  const res = await httpSend(resolved, requestId, currentRequestSettings());

  // 3. Test script — against the response; its env/globals writes fold too.
  let error: string | undefined;
  if (req.testScript && req.testScript.trim() !== '') {
    const context = buildScriptContext(resolved, res, activeEnvMap(), globalsMap(), iterationData);
    const post = await runScript('test', req.testScript, context);
    applyScriptVars(post);
    logs.push(...post.logs);
    tests.push(...post.tests);
    error = post.error ?? undefined;
  }

  return { status: res.status, elapsedMs: res.elapsed_ms, tests, logs, error, body: res.body, size: res.size_bytes };
}

/**
 * Execute one saved HTTP request for iteration `iteration` and return its row.
 * A transport throw becomes an `ok:false` row (never crashes the run).
 * Exported for entities/flow/store.ts (a Flow request block is one runner row).
 */
export async function runHttpNode(
  node: RequestNode,
  iteration: number,
  iterationData: Record<string, string>,
): Promise<RunResultRow> {
  const scope = runScopeFor(iterationData);
  const finalUrl = buildUrl(node.request.url, node.params);
  const target = resolveVars(finalUrl, scope);
  try {
    const outgoing = buildRequestForSend(withInheritedAuth(node, node.id), finalUrl);
    const out = await runHttp(outgoing, iterationData);
    const ok = out.error === undefined && out.status >= 200 && out.status < 300 && allTestsPassed(out.tests);
    return {
      id: crypto.randomUUID(),
      iteration,
      requestName: node.name,
      protocol: 'http',
      method: node.request.method,
      target,
      status: out.status,
      ok,
      elapsedMs: out.elapsedMs,
      tests: out.tests,
      logs: out.logs,
      error: out.error,
      responseBody: out.body,
      nodeId: node.id,
      sizeBytes: out.size,
    };
  } catch (e) {
    return {
      id: crypto.randomUUID(),
      iteration,
      requestName: node.name,
      protocol: 'http',
      method: node.request.method,
      target,
      nodeId: node.id,
      status: 'ERR',
      ok: false,
      elapsedMs: 0,
      tests: [],
      logs: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Execute one saved gRPC request for iteration `iteration` and return its row.
 * Mirrors `runHttp`'s script pipeline (pre-request + test, folding env/globals
 * writes via `applyScriptVars`), with one gRPC-specific constraint: the
 * pre-request script runs AFTER the connection is dialed (a live connection is
 * needed just to know the method exists), so it can patch message/metadata but
 * not the endpoint. The whole connect → (proto/reflect) → call cycle is
 * wrapped so ANY failure yields an `ok:false` row and the run continues.
 * Exported for entities/flow/store.ts (a Flow request block is one runner row).
 */
export async function runGrpcNode(
  node: RequestNode,
  iteration: number,
  iterationData: Record<string, string>,
): Promise<RunResultRow> {
  const g = node.grpc;
  const scope = runScopeFor(iterationData);
  const endpoint = resolveVars(g?.endpoint ?? '', scope);
  const target = `${endpoint} · ${g?.method ? methodShort(g.method) : ''}`.trim();
  const tests: ScriptTestResult[] = [];
  const logs: string[] = [];
  const base = {
    id: crypto.randomUUID(),
    iteration,
    requestName: node.name,
    protocol: 'grpc' as const,
    method: 'gRPC',
    target,
    tests,
    logs,
    nodeId: node.id,
  };
  if (!g || !g.endpoint.trim() || !g.method) {
    return { ...base, status: 'ERR', ok: false, elapsedMs: 0, error: t('runner.err.missingEndpoint') };
  }
  try {
    // Plaintext: honour the saved flag, else infer from the RESOLVED endpoint
    // (the :443 may live inside a {{var}} value).
    const plaintext = g.plaintext !== undefined ? g.plaintext : inferGrpcPlaintext(endpoint);
    const connId = await grpcConnect(
      endpoint,
      plaintext,
      grpcTlsFor(endpoint, g.tls),
      requestPrefs.requestTimeoutMs,
      currentGrpcPrefs(),
    );
    // Load the schema so the call can be encoded: proto source compiles files,
    // otherwise reflection lists the services.
    if (g.source === 'proto') {
      const abs = grpcPathsToAbs(g, get(workspacePath));
      await grpcLoadProto(connId, abs?.protoPaths ?? [], withGlobalImports(abs?.importPaths ?? []));
    } else {
      await grpcReflect(connId);
    }

    let message = g.message;
    let metadata = g.metadata;
    if (g.preRequestScript && g.preRequestScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint, message, metadata },
        undefined,
        activeEnvMap(),
        globalsMap(),
        iterationData,
      );
      const pre = await runScript('pre-request', g.preRequestScript, context);
      applyScriptVars(pre);
      logs.push(...pre.logs);
      tests.push(...pre.tests);
      if (pre.error) return { ...base, status: 'ERR', ok: false, elapsedMs: 0, error: pre.error };
      const patched = applyGrpcRequestPatch({ method: g.method, endpoint, message, metadata }, pre.requestPatch);
      message = patched.message;
      metadata = patched.metadata;
    }

    const resolvedMessage = resolveVars(message, scope);
    const merged = grpcAuthMetadata(effectiveAuth(get(collections), node.id, g.auth), (v) => resolveVars(v, scope));
    for (const [k, v] of Object.entries(metadata)) merged[k] = resolveVars(v, scope);
    const resolvedMetadata = outgoingGrpcMetadata(merged, stripsAuthorization(g, plaintext));
    const result = await grpcCall(
      connId,
      g.method,
      resolvedMessage,
      resolvedMetadata,
      undefined,
      requestPrefs.grpcDeadlineMs,
    );

    let error: string | undefined;
    if (g.testScript && g.testScript.trim() !== '') {
      const context = buildGrpcScriptContext(
        { method: g.method, endpoint, message: resolvedMessage, metadata: resolvedMetadata },
        result,
        activeEnvMap(),
        globalsMap(),
        iterationData,
      );
      const post = await runScript('test', g.testScript, context);
      applyScriptVars(post);
      logs.push(...post.logs);
      tests.push(...post.tests);
      error = post.error ?? undefined;
    }

    return {
      ...base,
      status: result.status,
      ok: result.ok && error === undefined && allTestsPassed(tests),
      elapsedMs: result.elapsed_ms,
      error,
      responseBody: result.body,
      sizeBytes: result.size_bytes,
    };
  } catch (e) {
    return {
      ...base,
      status: 'ERR',
      ok: false,
      elapsedMs: 0,
      error: grpcConnectFailureMessage(g.source, 'dial', e),
    };
  }
}

export const runNode = (node: RequestNode, iteration: number, data: Record<string, string>) =>
  node.protocol === 'grpc' ? runGrpcNode(node, iteration, data) : runHttpNode(node, iteration, data);
