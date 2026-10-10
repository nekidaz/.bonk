/**
 * Pure helpers + types for Postman-style user scripts (pre-request + test).
 *
 * This module is a leaf: it imports only types, never stores or the api layer,
 * so the stores import graph stays acyclic. `requests.ts` orchestrates the run
 * flow using `buildScriptContext` + `applyEnvPatch`; `api.ts` uses
 * `parseScriptResult` to turn the raw QuickJS output string into a typed value.
 */
import { t as tr } from '$shared/i18n';
import type {
  GrpcResult,
  HttpRequest,
  HttpResponse,
  ScriptEvent,
  ScriptStage,
  ScriptTestResult,
  TabTestResults,
  VarRow,
} from './types';

/**
 * Master switch for the Scripts tab (HTTP + gRPC). When false the editor tab is hidden; scripts already saved in
 * requests still run on send / in the runner / in flows. Flip to `true` to bring the tab back.
 */
export const SCRIPTS_ENABLED = true;

export type ScriptPhase = 'pre-request' | 'test' | 'flow';

/** Parsed shape of the `__out` object the QuickJS `run_script` returns. */
export interface ScriptResult {
  logs: string[];
  tests: ScriptTestResult[];
  /** env vars the script set: `name → value`. */
  envSet: Record<string, string>;
  /** env var names the script removed. */
  envUnset: string[];
  /** globals the script set: `name → value`. */
  globalsSet: Record<string, string>;
  /** global var names the script removed. */
  globalsUnset: string[];
  /** URLs whose cookies `pm.cookies.jar().clear(url)` asked to delete. */
  cookieClears?: string[];
  /** Mutations to apply to the outgoing request (pre-request only). */
  requestPatch?: RequestPatch | null;
  /** Fatal error (thrown/timeout) captured from the script, if any. */
  error?: string | null;
  /** Editor line of `error` (1-based), when the sandbox could pin it. */
  errorLine?: number | null;
  /** Console feed rows in run order (stage is filled in by `collectScriptRun`). */
  events?: Omit<ScriptEvent, 'stage'>[];
  /** The script's top-level `return` value (Flow blocks); undefined when none. */
  returnValue?: unknown;
}

/** The subset of request fields a pre-request script may overwrite. */
export interface RequestPatch {
  url?: string;
  body?: string;
  headers?: Record<string, string>;
}

/** The response fields exposed to a test script via `pm.response`. */
export interface ScriptResponseContext {
  code: number;
  responseTime: number;
  headers: Record<string, string>;
  body: string;
}

/** The full context object passed to a script run. */
export interface ScriptContext {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    /** gRPC: the endpoint is dialed before the script runs, so `pm.request.url` can't be set. */
    readonlyUrl?: boolean;
  };
  response: ScriptResponseContext | null;
  environment: Record<string, string>;
  globals: Record<string, string>;
  /**
   * The current Collection Runner iteration's data row (`name → value`), or `{}`
   * outside a data-driven run. Exposed to scripts as `pm.iterationData` and takes
   * precedence over env/globals in `pm.variables.get`.
   */
  iterationData: Record<string, string>;
  /** Flow block payload, exposed to the script as the `payload` global. */
  payload?: unknown;
  /** Cookies going to the request URL, exposed as `pm.cookies`. */
  cookies?: { name: string; value: string }[];
}

/**
 * Assemble the `{request, response?, environment, globals, iterationData}`
 * context object for a script run. `environment` / `globals` are plain
 * `name → value` maps (built by the caller from the active env + globals rows).
 * `response` is null for the pre-request phase and populated for the test phase.
 * `iterationData` defaults to `{}` so interactive-send callers (which have no
 * data file) keep working unchanged; the Collection Runner passes the row.
 */
export function buildScriptContext(
  req: HttpRequest,
  response: HttpResponse | undefined,
  environment: Record<string, string>,
  globals: Record<string, string>,
  iterationData: Record<string, string> = {},
  cookies: { name: string; value: string }[] = [],
): ScriptContext {
  return {
    cookies,
    request: {
      method: req.method,
      url: req.url,
      headers: { ...(req.headers ?? {}) },
      body: req.body,
    },
    response: response
      ? {
          code: response.status,
          responseTime: response.elapsed_ms,
          headers: { ...response.headers },
          body: response.body,
        }
      : null,
    environment,
    globals,
    iterationData,
  };
}

/**
 * Apply a pre-request script's `requestPatch` to the outgoing request, returning
 * a new request (the input is never mutated). Only url/body/headers can be
 * patched; a patched `headers` object replaces the header map wholesale (the
 * script started from a copy of the originals, so additions are preserved).
 */
export function applyRequestPatch(req: HttpRequest, patch: RequestPatch | null | undefined): HttpRequest {
  if (!patch) return req;
  const next: HttpRequest = { ...req };
  if (patch.url !== undefined) next.url = patch.url;
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.headers !== undefined) next.headers = { ...patch.headers };
  return next;
}

/** The gRPC fields a pre-request script may read/patch, shaped like an HTTP request. */
export interface GrpcScriptRequest {
  method?: string;
  endpoint: string;
  message: string;
  metadata: Record<string, string>;
}

/**
 * Build a script context for a gRPC call. The sandbox (`scripts.rs`) is
 * protocol-agnostic — it only ever sees a plain `{request, response,
 * environment, globals}` object — so gRPC reuses the exact same shape as HTTP
 * via this field mapping: endpoint→url, metadata→headers, message→body.
 * gRPC has no numeric status code (only OK/ERROR/CANCELLED text), so
 * `response.code` approximates the real `grpc.Status` enum: 0 (OK) on success,
 * 2 (UNKNOWN) on any failure — enough for `pm.expect(pm.response).to.have.status(0)`.
 */
export function buildGrpcScriptContext(
  grpc: GrpcScriptRequest,
  result: GrpcResult | undefined,
  environment: Record<string, string>,
  globals: Record<string, string>,
  iterationData: Record<string, string> = {},
): ScriptContext {
  return {
    request: {
      method: grpc.method ?? 'GRPC',
      url: grpc.endpoint,
      headers: { ...grpc.metadata },
      body: grpc.message,
      readonlyUrl: true,
    },
    response: result
      ? { code: result.ok ? 0 : 2, responseTime: result.elapsed_ms, headers: {}, body: result.body }
      : null,
    environment,
    globals,
    iterationData,
  };
}

/**
 * Apply a pre-request script's `requestPatch` to a gRPC request, returning a
 * new value (the input is never mutated). Mirrors `applyRequestPatch`: url →
 * endpoint, body → message, headers → metadata (replaces the map wholesale).
 */
export function applyGrpcRequestPatch(
  grpc: GrpcScriptRequest,
  patch: RequestPatch | null | undefined,
): GrpcScriptRequest {
  if (!patch) return grpc;
  const next: GrpcScriptRequest = { ...grpc };
  if (patch.url !== undefined) next.endpoint = patch.url;
  if (patch.body !== undefined) next.message = patch.body;
  if (patch.headers !== undefined) next.metadata = { ...patch.headers };
  return next;
}

/**
 * Apply a script's `set` (name → value) and `unset` (names) to a list of
 * variable rows, returning a new list (the input is never mutated). An existing
 * enabled row with a matching key is updated in place; a new key is appended as
 * an enabled row. Unset removes matching rows. This is what folds
 * `pm.environment.set/unset` (and the globals equivalents) back into the UI's
 * var-row model.
 */
export function applyEnvPatch(rows: VarRow[], set: Record<string, string>, unset: string[]): VarRow[] {
  const unsetSet = new Set(unset);
  const next: VarRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (unsetSet.has(row.key)) continue;
    if (Object.prototype.hasOwnProperty.call(set, row.key)) {
      next.push({ ...row, value: set[row.key], enabled: true });
      seen.add(row.key);
    } else {
      next.push(row);
    }
  }
  for (const [key, value] of Object.entries(set)) {
    if (!seen.has(key)) next.push({ key, value, enabled: true });
  }
  return next;
}

/** Coerce an unknown value to a string array, dropping non-strings. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Coerce an unknown value to a `Record<string, string>`. */
function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

/** Parse the raw `__out` JSON string from `run_script` into a `ScriptResult`. */
export function parseScriptResult(raw: string): ScriptResult {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    return emptyResult(tr('script.bad_output', { output: raw.slice(0, 200) }));
  }
  const tests = Array.isArray(data.tests)
    ? (data.tests as unknown[]).flatMap((t) => {
        if (!t || typeof t !== 'object') return [];
        const row = t as Record<string, unknown>;
        return [
          {
            name: typeof row.name === 'string' ? row.name : tr('script.unnamed'),
            passed: row.passed === true,
            error: typeof row.error === 'string' ? row.error : undefined,
            line: typeof row.line === 'number' ? row.line : undefined,
            errorLine: typeof row.errorLine === 'number' ? row.errorLine : undefined,
          },
        ];
      })
    : [];
  const patch = data.requestPatch;
  return {
    logs: stringArray(data.logs),
    tests,
    envSet: stringRecord(data.envSet),
    envUnset: stringArray(data.envUnset),
    globalsSet: stringRecord(data.globalsSet),
    globalsUnset: stringArray(data.globalsUnset),
    cookieClears: stringArray(data.cookieClears),
    requestPatch:
      patch && typeof patch === 'object'
        ? {
            url: typeof (patch as RequestPatch).url === 'string' ? (patch as RequestPatch).url : undefined,
            body: typeof (patch as RequestPatch).body === 'string' ? (patch as RequestPatch).body : undefined,
            headers:
              (patch as Record<string, unknown>).headers &&
              typeof (patch as Record<string, unknown>).headers === 'object'
                ? stringRecord((patch as Record<string, unknown>).headers)
                : undefined,
          }
        : null,
    error: typeof data.error === 'string' ? data.error : null,
    errorLine: typeof data.errorLine === 'number' ? data.errorLine : null,
    events: Array.isArray(data.events) ? data.events.flatMap(parseEvent) : [],
    returnValue: data.returnValue,
  };
}

const EVENT_KINDS = new Set(['log', 'env', 'glob', 'hdr', 'test']);

function parseEvent(raw: unknown): Omit<ScriptEvent, 'stage'>[] {
  if (!raw || typeof raw !== 'object') return [];
  const e = raw as Record<string, unknown>;
  if (typeof e.kind !== 'string' || !EVENT_KINDS.has(e.kind)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return [
    {
      t: typeof e.t === 'number' ? e.t : 0,
      kind: e.kind as ScriptEvent['kind'],
      text: str(e.text),
      op: str(e.op),
      key: str(e.key),
      value: str(e.value),
      name: str(e.name),
      passed: typeof e.passed === 'boolean' ? e.passed : undefined,
    },
  ];
}

/** A script run that never produced output (runner threw / timed out), shaped like a failed result. */
export function scriptFailure(error: string): ScriptResult {
  return emptyResult(error);
}

function emptyResult(error: string): ScriptResult {
  return {
    logs: [],
    tests: [],
    envSet: {},
    envUnset: [],
    globalsSet: {},
    globalsUnset: [],
    requestPatch: null,
    error,
  };
}

/** True when every recorded test passed (vacuously true with no tests). */
export function allTestsPassed(tests: ScriptTestResult[]): boolean {
  return tests.every((t) => t.passed);
}

/**
 * Fold one request's script runs into what its tab shows (SC4–SC6): tests of both stages tagged with
 * their stage, one console feed (pre rows, the send row, post rows), and the first fatal error with
 * its stage and line. `undefined` when neither stage had a script.
 */
export function collectScriptRun(run: {
  pre?: ScriptResult;
  post?: ScriptResult;
  send?: Omit<ScriptEvent, 'stage' | 'kind'>;
  postMs?: number;
  at?: number;
}): TabTestResults | undefined {
  const { pre, post } = run;
  if (!pre && !post) return undefined;
  const stage = (r: ScriptResult | undefined, s: ScriptStage) => ({
    tests: (r?.tests ?? []).map((t) => ({ ...t, stage: s })),
    events: (r?.events ?? []).map((e) => ({ ...e, stage: s })),
  });
  const a = stage(pre, 'pre');
  const b = stage(post, 'post');
  const failed = pre?.error ? pre : post?.error ? post : undefined;
  return {
    tests: [...a.tests, ...b.tests],
    logs: [...(pre?.logs ?? []), ...(post?.logs ?? [])],
    error: failed?.error ?? undefined,
    errorLine: failed?.errorLine ?? undefined,
    errorPhase: failed ? (failed === pre ? 'pre' : 'post') : undefined,
    events: [
      ...a.events,
      ...(run.send ? [{ ...run.send, stage: 'send' as const, kind: 'send' as const }] : []),
      ...b.events,
    ],
    postMs: run.postMs,
    at: run.at,
  };
}
