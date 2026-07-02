/**
 * Pure helpers + types for Postman-style user scripts (pre-request + test).
 *
 * This module is a leaf: it imports only types, never stores or the api layer,
 * so the stores import graph stays acyclic. `requests.ts` orchestrates the run
 * flow using `buildScriptContext` + `applyEnvPatch`; `api.ts` uses
 * `parseScriptResult` to turn the raw QuickJS output string into a typed value.
 */
import type { HttpRequest, HttpResponse, ScriptTestResult, VarRow } from './types';

export type ScriptPhase = 'pre-request' | 'test';

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
  /** Mutations to apply to the outgoing request (pre-request only). */
  requestPatch?: RequestPatch | null;
  /** Fatal error (thrown/timeout) captured from the script, if any. */
  error?: string | null;
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
): ScriptContext {
  return {
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

/**
 * Apply a script's `set` (name → value) and `unset` (names) to a list of
 * variable rows, returning a new list (the input is never mutated). An existing
 * enabled row with a matching key is updated in place; a new key is appended as
 * an enabled row. Unset removes matching rows. This is what folds
 * `pm.environment.set/unset` (and the globals equivalents) back into the UI's
 * var-row model.
 */
export function applyEnvPatch(
  rows: VarRow[],
  set: Record<string, string>,
  unset: string[],
): VarRow[] {
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
    return emptyResult(`script returned invalid output: ${raw.slice(0, 200)}`);
  }
  const tests = Array.isArray(data.tests)
    ? (data.tests as unknown[]).flatMap((t) => {
        if (!t || typeof t !== 'object') return [];
        const row = t as Record<string, unknown>;
        return [
          {
            name: typeof row.name === 'string' ? row.name : '(unnamed)',
            passed: row.passed === true,
            error: typeof row.error === 'string' ? row.error : undefined,
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
  };
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
